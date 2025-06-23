# Vibe Card Simulator

A virtual card table for uploading, managing, and playing with custom decks in your browser.

---

## Getting Started

### 1. **Install Node.js**

Download and install Node.js from [nodejs.org](https://nodejs.org/).

---

### 2. **Install Dependencies**

Open a terminal in the project folder and run:

```
npm install
```

---

### 3. **Run the Server**

To start the server:

```
npm start
```

For development with auto-restart on file changes (requires `nodemon`):

```
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

---

### 4. **(Optional) Expose to the Internet with Cloudflare Tunnel**

If you want to share your local server with others, install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) and run:

```
cloudflared tunnel --url http://localhost:3000
```

This will give you a public URL to share.

---

## Features

- Upload custom decks and card backs.
- Drag and drop cards and decks.
- Create piles and add cards to top or bottom.
- Deck menu on the right to quickly add uploaded decks to the table.
- Real-time multiplayer via Socket.IO.

---

## Folder Structure

- `client/` - Frontend files (HTML, CSS, JS, assets)
- `uploads/` - Uploaded decks and images (ignored by git)
- `server.js` - Main server file

---

## Requirements

- Node.js (v18 or higher recommended)
- npm (comes with Node.js)
- (Optional) [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) for tunneling

---

## Notes

- Uploaded decks are stored in the `uploads/` folder.
- `.gitignore` is set to ignore `uploads/` and `node_modules/`.

---

Enjoy your virtual card table!