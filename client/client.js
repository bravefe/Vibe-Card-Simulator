const socket = io();
const gameBoard = document.getElementById('game-board');

let selectedElement = null; // To track the selected card for rotation
const latestDecks = {}; // Add this line at the top
let currentDeckSearchId = null;
let deckAddMode = 'bottom'; // 'top' or 'bottom'

// --- Render Functions ---
function renderDeck(deckData) {
    latestDecks[deckData.id] = deckData; // Track latest deck data
    let deckEl = document.getElementById(deckData.id);
    if (!deckEl) {
        deckEl = document.createElement('div');
        deckEl.id = deckData.id;
        deckEl.className = 'deck';

        // --- Shuffle Button ---
        const shuffleBtn = document.createElement('button');
        shuffleBtn.type = 'button';
        shuffleBtn.className = 'shuffle-btn';
        shuffleBtn.title = 'Shuffle Deck';
        shuffleBtn.innerHTML = '🔀';
        shuffleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            socket.emit('shuffleDeck', deckData.id);
            socket.emit('highlightDeck', { id: deckData.id, color: 'yellow', add: true }); // Highlight yellow for all
        });

        // Add the button to the deck element
        deckEl.appendChild(shuffleBtn);

        gameBoard.appendChild(deckEl);

        // --- Prevent click after drag ---
        let wasDragged = false;
        deckEl.addEventListener('mousedown', () => { wasDragged = false; });
        deckEl.addEventListener('mousemove', () => { wasDragged = true; });

        // Click to draw
        deckEl.addEventListener('click', (e) => {
            if (wasDragged) {
                wasDragged = false;
                return;
            }
            socket.emit('drawCard', deckData.id);
        });

        deckEl.addEventListener('mouseenter', () => selectedElement = deckEl);
        deckEl.addEventListener('mouseleave', () => selectedElement = null);

        // Right-click to show deck search modal
        deckEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            socket.emit('highlightDeck', { id: deckData.id, color: 'blue', add: true}); // Highlight blue for all
            showDeckSearchModal(deckData, e.clientX, e.clientY);
        });
    }
    deckEl.style.left = `${deckData.x}px`;
    deckEl.style.top = `${deckData.y}px`;
    deckEl.setAttribute('data-x', deckData.x);
    deckEl.setAttribute('data-y', deckData.y);
    deckEl.dataset.count = deckData.cards ? deckData.cards.length : deckData.cardCount;
    if (deckData.cards) deckEl._cards = deckData.cards.slice();

    // --- Card back logic for decks, but show top/bottom card for piles ---
    if (deckData.type === 'pile') {
        // Always show the last card in the pile if exists, else blank
        let cardUrl = '';
        if (deckData.cards && deckData.cards.length > 0) {
            cardUrl = deckData.cards[deckData.cards.length - 1];
        }
        deckEl.style.backgroundImage = cardUrl ? `url('${cardUrl}')` : '';
    } else {
        // Deck: show card back
        const deckFolder = deckData.id ? `/uploads/${deckData.id}` : null;
        const pngUrl = deckFolder ? `${deckFolder}/card-back.png` : '/assets/card-back.png';
        const jpgUrl = deckFolder ? `${deckFolder}/card-back.jpg` : '/assets/card-back.png';
        const webpUrl = deckFolder ? `${deckFolder}/card-back.webp` : '/assets/card-back.png';
        const tryUrls = [pngUrl, jpgUrl, webpUrl, '/assets/card-back.png'];
        let idx = 0;
        const img = new window.Image();
        img.onload = () => {
            deckEl.style.backgroundImage = `url('${img.src}')`;
        };
        img.onerror = () => {
            idx++;
            if (idx < tryUrls.length) {
                img.src = tryUrls[idx];
            } else {
                deckEl.style.backgroundImage = `url('/assets/card-back.png')`;
            }
        };
        img.src = tryUrls[idx];
    }
}

function renderCard(cardData) {
    let cardEl = document.getElementById(cardData.id);
    if (!cardEl) {
        cardEl = document.createElement('div');
        cardEl.id = cardData.id;
        cardEl.className = 'card';
        gameBoard.appendChild(cardEl);

        // Add hover listeners for rotation
        cardEl.addEventListener('mouseenter', () => selectedElement = cardEl);
        cardEl.addEventListener('mouseleave', () => selectedElement = null);

        // Add right-click to show modal - get fresh card data from gameState
        cardEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // Get the current card data from the element's current state
            const currentCardData = {
                id: cardEl.id,
                src: cardEl.style.backgroundImage.slice(5, -2), // Extract URL from background-image
                isFaceUp: !cardEl.classList.contains('hidden-card'),
                x: parseFloat(cardEl.style.left) || 0,
                y: parseFloat(cardEl.style.top) || 0,
                rotation: cardEl.style.transform ? parseFloat(cardEl.style.transform.match(/rotate\(([^)]+)deg\)/)?.[1] || 0) : 0
            };
            showCardModal(currentCardData);
        });
    }
    
    // Store the card data on the element for easy access
    cardEl._cardData = cardData;
    
    cardEl.style.left = `${cardData.x}px`;
    cardEl.style.top = `${cardData.y}px`;
    cardEl.setAttribute('data-x', cardData.x);
    cardEl.setAttribute('data-y', cardData.y);
    cardEl.style.transform = `rotate(${cardData.rotation || 0}deg)`;
    cardEl.style.backgroundImage = `url('${cardData.src}')`;

    // Highlight border red if card is face down (hidden from anyone)
    // Only add 'hidden-card' if the card is face down AND has an owner (i.e., truly hidden from all)
    if (!cardData.isFaceUp && cardData.owner === null) {
        cardEl.classList.remove('hidden-card'); // No red border for public face-down cards
    } else if (!cardData.isFaceUp) {
        cardEl.classList.add('hidden-card'); // Red border for hidden cards with owner
    } else {
        cardEl.classList.remove('hidden-card');
    }
}

// --- Socket.IO Event Listeners ---
function renderCardWithBack(card, useCardBack = false) {
    if (!useCardBack) {
        renderCard(card);
        return;
    }

    // Try to use deck-specific card-back (png, jpg, webp)
    const deckFolder = card.deckId ? `/uploads/${card.deckId}` : null;
    const pngUrl = deckFolder ? `${deckFolder}/card-back.png` : '/assets/card-back.png';
    const jpgUrl = deckFolder ? `${deckFolder}/card-back.jpg` : '/assets/card-back.png';
    const webpUrl = deckFolder ? `${deckFolder}/card-back.webp` : '/assets/card-back.png';
    const tryUrls = [pngUrl, jpgUrl, webpUrl, '/assets/card-back.png'];
    let idx = 0;
    const img = new window.Image();
    img.onload = () => {
        renderCard({ ...card, src: img.src });
    };
    img.onerror = () => {
        idx++;
        if (idx < tryUrls.length) {
            img.src = tryUrls[idx];
        } else {
            renderCard({ ...card, src: '/assets/card-back.png' });
        }
    };
    img.src = tryUrls[idx];
}

// Fixed currentGameState handler
socket.on('currentGameState', (state) => {
    gameBoard.innerHTML = ''; // Clear board
    for (const deckId in state.decks) {
        renderDeck(state.decks[deckId]);
    }
    for (const cardId in state.cards) {
        const card = state.cards[cardId];
        // If we don't own the card and it's face down, show the deck-specific back
        if (card.owner !== socket.id && !card.isFaceUp) {
            renderCardWithBack(card, true);
        } else {
            renderCard(card);
        }
    }
});

socket.on('deckCreated', renderDeck);
socket.on('deckMoved', (data) => {
    const el = document.getElementById(data.id);
    if (el) {
        el.style.left = `${data.x}px`;
        el.style.top = `${data.y}px`;
    }
});
socket.on('deckUpdated', (data) => {
    const el = document.getElementById(data.id);
    if (el) el.dataset.count = data.cardCount;
});

socket.on('cardDrawn', renderCard); // You drew this card, you can see it
socket.on('opponentCardDrawn', (card) => {
    renderCardWithBack(card, true);
});

socket.on('cardMoved', (data) => {
    const el = document.getElementById(data.id);
    if (el) {
        el.style.left = `${data.x}px`;
        el.style.top = `${data.y}px`;
    }
});

socket.on('cardFlipped', (data) => {
    const cardEl = document.getElementById(data.id);
    if (cardEl) {
        let newSrc;
        if (data.isFaceUp) {
            newSrc = data.src;
        } else {
            // Try to use deck-specific card-back (png, jpg, webp)
            const deckFolder = data.deckId ? `/uploads/${data.deckId}` : null;
            const pngUrl = deckFolder ? `${deckFolder}/card-back.png` : '/assets/card-back.png';
            const jpgUrl = deckFolder ? `${deckFolder}/card-back.jpg` : '/assets/card-back.png';
            const webpUrl = deckFolder ? `${deckFolder}/card-back.webp` : '/assets/card-back.png';

            // Try loading png, then jpg, then webp, then fallback to default
            const tryUrls = [pngUrl, jpgUrl, webpUrl, '/assets/card-back.png'];
            let idx = 0;
            const img = new window.Image();
            img.onload = () => {
                cardEl.style.backgroundImage = `url('${img.src}')`;
            };
            img.onerror = () => {
                idx++;
                if (idx < tryUrls.length) {
                    img.src = tryUrls[idx];
                } else {
                    cardEl.style.backgroundImage = `url('/assets/card-back.png')`;
                }
            };
            img.src = tryUrls[idx];
            return; // Don't run the line below, handled in onload/onerror
        }
        cardEl.style.backgroundImage = `url('${newSrc}')`;
        cardEl.classList.remove('hidden-card');
    }
});

socket.on('cardRotated', (data) => {
    const el = document.getElementById(data.id);
    if (el) {
        el.style.transform = `rotate(${data.rotation}deg)`;
    }
});

socket.on('cardChangeLayer', (data) => {
    const el = document.getElementById(data.id);
    if (el) {
        el.style.zIndex = data.layer;
    }
});

socket.on('deckShuffled', (deckData) => {
    renderDeck(deckData);
});

socket.on('deckHighlight', ({ id, color, add}) => {
    const deckEl = document.getElementById(id);
    if (!deckEl) return;
    if (color === 'blue' && add) {
        deckEl.classList.add('highlight-blue');
        // setTimeout(() => deckEl.classList.remove('highlight-blue'), 2000); // Remove after 2s
    } else if (color === 'yellow') {
        deckEl.classList.add('highlight-yellow');
        setTimeout(() => deckEl.classList.remove('highlight-yellow'), 800); 
    } else if (color === 'blue' && !add) {
        deckEl.classList.remove('highlight-blue');
    }
});

// --- User Interactions ---

// Deck Upload
document.getElementById('uploadForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const formData = new FormData(this);
    fetch('/upload', {
        method: 'POST',
        body: formData
    }).then(response => response.json())
      .then(data => console.log(data.message))
      .catch(error => console.error('Error uploading deck:', error));
});

// Drag and Drop with Interact.js
// interact('.card, .deck').draggable({
//     listeners: {
//         move(event) {
//             const target = event.target;
//             const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
//             const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
            
//             target.style.left = `${x}px`;
//             target.style.top = `${y}px`;

//             target.setAttribute('data-x', x);
//             target.setAttribute('data-y', y);
//         },
//         end(event) {
//             const target = event.target;
//             const x = parseFloat(target.style.left);
//             const y = parseFloat(target.style.top);
            
//             // Emit the final position to the server
//             const eventName = target.classList.contains('card') ? 'moveCard' : 'moveDeck';
//             socket.emit(eventName, { id: target.id, x: x, y: y });
//         }
//     }
// });

interact('.card, .deck').draggable({
    listeners: {
        move(event) {
            const target = event.target;
            // Center the card/deck under the mouse
            const x = event.clientX - target.offsetWidth / 2;
            const y = event.clientY - target.offsetHeight / 2;
            target.style.left = `${x}px`;
            target.style.top = `${y}px`;
            target.setAttribute('data-x', x);
            target.setAttribute('data-y', y);

            // Emit position on every move for cards (not decks)
            if (target.classList.contains('card')) {
                socket.emit('moveCard', { id: target.id, x: x, y: y, deckAddMode }); // <-- add deckAddMode
            } else if (target.classList.contains('deck')) {
                socket.emit('moveDeck', { id: target.id, x: x, y: y });
            }
        },
        end(event) {
            // Optionally, you can still emit here for final sync, but it's not required anymore
        }
    }
});

// Rotate with 'R' key
document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'r' && selectedElement && selectedElement.classList.contains('card')) {
        e.preventDefault();
        socket.emit('rotateCard', { id: selectedElement.id });
    }
});

// Listen for delete key to remove card or deck
document.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElement) {
        e.preventDefault();
        if (selectedElement.classList.contains('card')) {
            socket.emit('deleteCard', selectedElement.id);
        } else if (selectedElement.classList.contains('deck')) {
            socket.emit('deleteDeck', selectedElement.id);
        }
    }
});

// Flip card with 'F' key
document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'f' && selectedElement && selectedElement.classList.contains('card')) {
        e.preventDefault();
        socket.emit('flipCard', selectedElement.id);
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key >= '0' && e.key <= '9' && selectedElement && selectedElement.classList.contains('card')) {
        e.preventDefault();
        const layer = parseInt(e.key);
        socket.emit('changeLayer', { id: selectedElement.id, layer});
    }
});

// Take card with 'E' key
document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'e' && selectedElement && selectedElement.classList.contains('card')) {
        e.preventDefault();
        socket.emit('takeCard', { id: selectedElement.id });
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'd' && selectedElement && selectedElement.classList.contains('deck')) {
        e.preventDefault();
        socket.emit('drawCardFaceDown', { deckId: selectedElement.id, faceDown: true });
    }
});

// Remove card or deck from DOM when deleted
socket.on('cardDeleted', (cardId) => {
    const el = document.getElementById(cardId);
    if (el) el.remove();
});
socket.on('deckDeleted', (deckId) => {
    const el = document.getElementById(deckId);
    if (el) el.remove();
});

// --- Deck Search Modal ---
function showDeckSearchModal(deckData, x, y) {
    currentDeckSearchId = deckData.id;
    const modal = document.getElementById('deck-search-modal');
    const list = document.getElementById('deck-search-list');
    list.innerHTML = '';

    // Use the latest deck data if available
    const cards = (latestDecks[deckData.id] && latestDecks[deckData.id].cards) || deckData.cards || [];

    cards.forEach((cardSrc, idx) => {
        const item = document.createElement('div');
        // Remove flex and margin styles, let CSS handle layout

        const img = document.createElement('img');
        img.src = cardSrc;
        img.onclick = () => {
            socket.emit('pickCardFromDeck', { deckId: deckData.id, cardIndex: idx });
            modal.style.display = 'none';
            if (currentDeckSearchId)
                socket.emit('highlightDeck', { id: currentDeckSearchId, color: 'blue', add: false });
            currentDeckSearchId = null;
        };

        item.appendChild(img);
        list.appendChild(item);
    });

    // Position and show modal
    modal.style.left = x + 'px';
    modal.style.top = y + 'px';
    modal.style.display = 'block';

    // socket.emit('shuffleDeck', deckData.id); // Shuffle the deck first
}

// Hide modal on close button
document.getElementById('deck-search-close').onclick = () => {
    document.getElementById('deck-search-modal').style.display = 'none';
    if (currentDeckSearchId)
        socket.emit('highlightDeck', { id: currentDeckSearchId, color: 'blue', add: false });
    currentDeckSearchId = null;
};

document.addEventListener('mousedown', (e) => {
    const modal = document.getElementById('deck-search-modal');
    if (modal.style.display === 'block' && !modal.contains(e.target)) {
        modal.style.display = 'none';
        if (currentDeckSearchId)
            socket.emit('highlightDeck', { id: currentDeckSearchId, color: 'blue', add: false });
        currentDeckSearchId = null;
    }
});

// --- Card Modal ---
function showCardModal(cardData) {
    const modal = document.getElementById('card-modal');
    const modalImg = document.getElementById('modal-img');
    modalImg.src = cardData.src;
    modal.style.display = 'flex';
}

// Hide the card modal when clicking anywhere on it
document.getElementById('card-modal').onclick = () => {
    document.getElementById('card-modal').style.display = 'none';
};

const deckAddModeBtn = document.getElementById('deckAddModeBtn');
deckAddModeBtn.onclick = () => {
    deckAddMode = deckAddMode === 'bottom' ? 'top' : 'bottom';
    deckAddModeBtn.textContent = deckAddMode === 'bottom' ? 'Add card to bottom deck' : 'Add card to top deck';
};

document.getElementById('cretePileBtn').onclick = () => {
    // Place pile at a default position, e.g., (200, 200)
    socket.emit('createPile', { x: 200, y: 200 });
};

function renderDeckMenu() {
    fetch('/api/decks')
        .then(res => res.json())
        .then(decks => {
            const menu = document.getElementById('deck-menu');
            menu.innerHTML = '';
            decks.forEach(deck => {
                const item = document.createElement('div');
                item.className = 'deck-menu-item';
                item.title = 'Click to add this deck to the table';

                const img = document.createElement('img');
                img.className = 'deck-menu-img';
                img.src = deck.cardBack;

                const info = document.createElement('div');
                info.className = 'deck-menu-info';

                const name = document.createElement('div');
                name.className = 'deck-menu-name';
                name.textContent = deck.name;

                const count = document.createElement('div');
                count.className = 'deck-menu-count';
                count.textContent = `${deck.cardCount} cards`;

                info.appendChild(name);
                info.appendChild(count);

                item.appendChild(img);
                item.appendChild(info);

                item.onclick = () => {
                    // Request server to add this deck to the table
                    socket.emit('addExistingDeck', { deckId: deck.id });
                };

                menu.appendChild(item);
            });
        });
}

// Fetch deck menu on load
renderDeckMenu();

// Optionally, refresh menu when a deck is uploaded
socket.on('deckCreated', () => {
    renderDeckMenu();
});

const deckMenu = document.getElementById('deck-menu');
const deckMenuToggle = document.getElementById('deck-menu-toggle');
deckMenuToggle.onclick = () => {
    deckMenu.classList.toggle('closed');
};

const shortcutsBtn = document.getElementById('show-shortcuts-btn');
const shortcutsPopup = document.getElementById('keyboard-shortcuts');

shortcutsBtn.onclick = (e) => {
    e.stopPropagation();
    shortcutsPopup.classList.add('open');
};

// Hide shortcuts when clicking anywhere else
document.addEventListener('mousedown', (e) => {
    if (shortcutsPopup.classList.contains('open') && !shortcutsPopup.contains(e.target) && e.target !== shortcutsBtn) {
        shortcutsPopup.classList.remove('open');
    }
});