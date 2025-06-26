const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // To give each card a unique ID
const os = require('os');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- Game State ---
// This is the single source of truth for the game.
let gameState = {
    decks: {},
    cards: {}
};

// Store card backs per player
let playerCardBacks = {};

// --- File Uploads with Multer ---
// We'll use a dynamic destination based on a deck UUID
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        // Get deck name from the form field (works for multipart/form-data)
        let deckNameRaw = req.body.deckName;
        if (!deckNameRaw || typeof deckNameRaw !== 'string') {
            deckNameRaw = 'untitled';
        }
        // Sanitize deck name
        const deckId = deckNameRaw.trim().replace(/[^a-zA-Z0-9-_]/g, '_');
        const deckFolder = path.join('uploads', deckId);
        if (!fs.existsSync(deckFolder)) {
            fs.mkdirSync(deckFolder, { recursive: true });
        }
        cb(null, deckFolder);
    },
    filename: function(req, file, cb) {
        cb(null, uuidv4() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- Static File Serving ---
// Serve the client files (HTML, CSS, JS) and the uploaded images
app.use(express.static(path.join(__dirname, 'client')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- API Endpoint for Deck Upload ---
app.post('/upload', upload.fields([
    { name: 'deckImages', maxCount: 100 },
    { name: 'cardBack', maxCount: 1 }
]), (req, res) => {
    if (!req.files || !req.files['deckImages']) {
        return res.status(400).send('No files were uploaded.');
    }

    const deckNameRaw = req.body.deckName;
    if (!deckNameRaw || typeof deckNameRaw !== 'string') {
        return res.status(400).send('Deck name is required.');
    }

    // Sanitize deck name: remove special characters and spaces
    const deckId = deckNameRaw.trim().replace(/[^a-zA-Z0-9-_]/g, '_');

    const cardImageUrls = req.files['deckImages'].map(file => `/${file.path.replace(/\\/g, '/')}`);

    // Ensure deck directory exists
    const deckFolderPath = path.join('uploads', deckId);
    if (!fs.existsSync(deckFolderPath)) {
        fs.mkdirSync(deckFolderPath, { recursive: true });
    }

    // Move card images to correct deck folder
    req.files['deckImages'].forEach(file => {
        const destPath = path.join(deckFolderPath, file.originalname);
        fs.renameSync(file.path, destPath);
    });

    // Save card back
    if (req.files['cardBack'] && req.files['cardBack'][0]) {
        const cardBackFile = req.files['cardBack'][0];
        const ext = path.extname(cardBackFile.originalname).toLowerCase();
        const destPath = path.join(deckFolderPath, `card-back${ext}`);
        fs.renameSync(cardBackFile.path, destPath);
    }

    // Build image URLs (assuming /uploads is public)
    const finalCardUrls = req.files['deckImages'].map(file =>
        `/uploads/${deckId}/${file.originalname}`
    );

    // Shuffle
    for (let i = finalCardUrls.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [finalCardUrls[i], finalCardUrls[j]] = [finalCardUrls[j], finalCardUrls[i]];
    }

    gameState.decks[deckId] = {
        id: deckId,
        cards: finalCardUrls,
        x: 100,
        y: 100
    };

    io.emit('deckCreated', gameState.decks[deckId]);
    res.status(200).json({ message: 'Deck created successfully!', deckId: deckId });
});

app.get('/api/decks', (req, res) => {
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) return res.json([]);
    const deckFolders = fs.readdirSync(uploadsDir).filter(f => fs.statSync(path.join(uploadsDir, f)).isDirectory());
    const decks = deckFolders.map(deckId => {
        const deckPath = path.join(uploadsDir, deckId);
        const files = fs.readdirSync(deckPath);
        const cardBack = files.find(f => f.startsWith('card-back'));
        const deckImages = files.filter(f => f !== cardBack && /\.(png|jpg|jpeg|webp)$/i.test(f));
        return {
            id: deckId,
            name: deckId,
            cardBack: cardBack ? `/uploads/${deckId}/${cardBack}` : '/assets/card-back.png',
            cardCount: deckImages.length
        };
    });
    res.json(decks);
});

// --- Socket.IO Connection Logic ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Send the current game state to the new user
    socket.emit('currentGameState', gameState);

    // Send the player's card back on connect (if any)
    socket.emit('cardBackSet', playerCardBacks[socket.id] || null);

    // Allow client to request their card back at any time
    socket.on('getCardBack', () => {
        socket.emit('cardBackSet', playerCardBacks[socket.id] || null);
    });

    // --- Event Handlers ---
    socket.on('moveCard', (data) => {
        const card = gameState.cards[data.id];
        if (card) {
            card.x = data.x;
            card.y = data.y;

            // Check proximity to all decks
            let merged = false;
            for (const deckId in gameState.decks) {
                const deck = gameState.decks[deckId];
                const dx = card.x - deck.x;
                const dy = card.y - deck.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < 20) {
                    // Merge card into deck at top or bottom
                    if (data.deckAddMode === 'top') {
                        deck.cards.push(card.src);
                    } else {
                        deck.cards.unshift(card.src);
                    }
                    delete gameState.cards[data.id];
                    io.emit('cardDeleted', data.id);
                    io.emit('deckUpdated', { id: deckId, cardCount: deck.cards.length });
                    io.emit('deckCreated', gameState.decks[deckId]);
                    merged = true;
                    break;
                }
            }

            if (!merged) {
                socket.broadcast.emit('cardMoved', data);
            }
        }
    });

    socket.on('moveDeck', (data) => {
        if (gameState.decks[data.id]) {
            gameState.decks[data.id].x = data.x;
            gameState.decks[data.id].y = data.y;
            socket.broadcast.emit('deckMoved', data);
        }
    });

    socket.on('drawCard', (deckId) => {
        const deck = gameState.decks[deckId];
        if (deck && deck.cards.length > 0) {
            const cardSrc = deck.cards.pop();
            const cardId = `card-${uuidv4()}`;

            gameState.cards[cardId] = {
                id: cardId,
                src: cardSrc,
                x: deck.x + 50, // Place it next to the deck
                y: deck.y + 50,
                rotation: 0,
                isFaceUp: false,
                owner: socket.id, // The person who drew it
                deckId: deckId // <-- Add this line
            };

            // Tell the owner the details of the card they drew
            socket.emit('cardDrawn', gameState.cards[cardId]);

            // Tell everyone else a card was drawn, but not what it is
            socket.broadcast.emit('opponentCardDrawn', {
                ...gameState.cards[cardId]
                // ,
                // Try .png, but you can add logic for .jpg/.webp if needed
                // src: `/uploads/${deckId}/card-back.png`
            });

            // Update deck count for all
            io.emit('deckUpdated', { id: deckId, cardCount: deck.cards.length });
            // Also send the full updated deck so clients can update their card list
            io.emit('deckCreated', gameState.decks[deckId]);
        }
    });

    socket.on('drawCardFaceDown', (data) => {
    let deckId;
    if (typeof data === 'object') {
        deckId = data.deckId;
    } else {
        deckId = data;
    }
    const deck = gameState.decks[deckId];
    if (deck && deck.cards.length > 0) {
        const cardSrc = deck.cards.pop();
        const cardId = `card-${uuidv4()}`;
        gameState.cards[cardId] = {
            id: cardId,
            src: cardSrc,
            x: deck.x + 50,
            y: deck.y + 50,
            rotation: 0,
            isFaceUp: false, // Always face down
            owner: null,     // No owner, public
            deckId: deckId
        };
        // Send to all clients as a hidden card
        io.emit('opponentCardDrawn', {
            ...gameState.cards[cardId]
        });
        io.emit('deckUpdated', { id: deckId, cardCount: deck.cards.length });
        io.emit('deckCreated', gameState.decks[deckId]);
    }
    });

    socket.on('flipCard', (cardId) => {
        const card = gameState.cards[cardId];
        if (card) {
            card.isFaceUp = !card.isFaceUp;
            // Broadcast the flip to everyone, now revealing the true source
            io.emit('cardFlipped', { id: cardId, isFaceUp: card.isFaceUp, src: card.src, deckId: card.deckId });
        }
    });

    socket.on('changeLayer', (data) => {
        const card = gameState.cards[data.id];
        if (card) {
            // console.log(`🎯 CLIENT: Changing layer for card ${card} to ${data.layer}`);
            io.emit('cardChangeLayer', { id: data.id, layer: data.layer });
        }
    }); 

    socket.on('rotateCard', (data) => {
         const card = gameState.cards[data.id];
         if (card) {
             card.rotation = (card.rotation + 90);
             io.emit('cardRotated', { id: data.id, rotation: card.rotation });
         }
    });

    socket.on('deleteCard', (cardId) => {
        if (gameState.cards[cardId]) {
            delete gameState.cards[cardId];
            io.emit('cardDeleted', cardId);
        }
    });

    socket.on('deleteDeck', (deckId) => {
        if (gameState.decks[deckId]) {
            delete gameState.decks[deckId];
            io.emit('deckDeleted', deckId);
        }
    });

    socket.on('shuffleDeck', (deckId) => {
        const deck = gameState.decks[deckId];
        if (deck && Array.isArray(deck.cards)) {
            // Shuffle the deck
            for (let i = deck.cards.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck.cards[i], deck.cards[j]] = [deck.cards[j], deck.cards[i]];
            }
            // Notify all clients
            io.emit('deckShuffled', deck);
        }
    });

    socket.on('pickCardFromDeck', ({ deckId, cardIndex }) => {
        const deck = gameState.decks[deckId];
        if (deck && deck.cards && deck.cards[cardIndex]) {
            const cardSrc = deck.cards.splice(cardIndex, 1)[0];
            const cardId = `card-${uuidv4()}`;
            gameState.cards[cardId] = {
                id: cardId,
                src: cardSrc,
                x: deck.x + 50,
                y: deck.y + 50,
                rotation: 0,
                isFaceUp: true, // Everyone can see it
                owner: null, // No owner, it's public
                deckId: deckId // <-- Add this line
            };
            // Notify all clients to render the card face up
            io.emit('cardDrawn', gameState.cards[cardId]);
            // Update deck count and cards for all
            io.emit('deckCreated', deck);
            io.emit('deckUpdated', { id: deckId, cardCount: deck.cards.length });
        }
    });

    socket.on('highlightDeck', ({ id, color, add }) => {
        io.emit('deckHighlight', { id, color, add });
    });

    socket.on('createPile', (data) => {
        const pileId = `pile-${uuidv4()}`;
        gameState.decks[pileId] = {
            id: pileId,
            cards: [],
            x: data.x || 200,
            y: data.y || 200,
            type: 'pile'
        };
        io.emit('deckCreated', gameState.decks[pileId]);
    });

    socket.on('addExistingDeck', ({ deckId }) => {
        const deckFolderPath = path.join(__dirname, 'uploads', deckId);
        if (!fs.existsSync(deckFolderPath)) return;
        const files = fs.readdirSync(deckFolderPath);
        const cardBack = files.find(f => f.startsWith('card-back'));
        const deckImages = files.filter(f => f !== cardBack && /\.(png|jpg|jpeg|webp)$/i.test(f));
        const cardUrls = deckImages.map(f => `/uploads/${deckId}/${f}`);

        // Shuffle cards
        for (let i = cardUrls.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cardUrls[i], cardUrls[j]] = [cardUrls[j], cardUrls[i]];
        }

        // Place at default position (can randomize or stack)
        gameState.decks[deckId] = {
            id: deckId,
            cards: cardUrls,
            x: 100 + Math.floor(Math.random() * 200),
            y: 100 + Math.floor(Math.random() * 200)
        };
        io.emit('deckCreated', gameState.decks[deckId]);
    });

    socket.on('takeCard', (data) => {
        const card = gameState.cards[data.id];
        if (card) {
            card.owner = socket.id;
            card.isFaceUp = false;
            // Send the real card only to the owner
            socket.emit('cardDrawn', card);
            // Send a hidden version to all other clients
            socket.broadcast.emit('opponentCardDrawn', {
                ...card,
                src: '/assets/card-back.png', // or your default card back path
                isFaceUp: false
            });
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        // Here you could add logic to handle a player leaving (e.g., remove their cards)
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    const interfaces = os.networkInterfaces();
    let localIp = 'localhost';
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                localIp = iface.address;
                break;
            }
        }
    }
    // console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
    console.log(`Or on your network: http://${localIp}:${PORT}`);
});