const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Telegram bot token
const TELEGRAM_BOT_TOKEN = "7220176401:AAHf_0Vh3akSgPsOYobFMvkmvF2VQfz6XUQ";
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Admin Telegram ID
const ADMIN_TELEGRAM_ID = "6685026718";

// File to store codes (simple JSON database for now)
const DB_FILE = path.join(__dirname, 'codes.json');

// Initialize database
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ codes: [], usedCodes: [] }));
}

const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

// Save database
function saveDb() {
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
}

// Generate a unique 6-character code
function generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Telegram bot: Handle /getcode command
bot.onText(/\/getcode/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    // Generate a new code
    const code = generateCode();
    const isAdmin = userId === ADMIN_TELEGRAM_ID;

    // Store the code
    db.codes.push({ code, userId, isAdmin, createdAt: Date.now() });
    saveDb();

    // Send the code to the user with a custom message
    bot.sendMessage(chatId, `Welcome to HackNet Predictor! Your login code is: **${code}**\nThis code is valid for 1 hour.`);
});

// API endpoint to validate codes
app.post('/validate-code', (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.json({ success: false, message: "Please enter a code." });
    }

    const now = Date.now();
    const codeEntry = db.codes.find(c => c.code === code);

    if (!codeEntry) {
        return res.json({ success: false, message: "Invalid code." });
    }

    // Check if code is expired (1 hour)
    const expirationTime = 60 * 60 * 1000; // 1 hour in milliseconds
    if (now - codeEntry.createdAt > expirationTime) {
        return res.json({ success: false, message: "Code has expired." });
    }

    // Check if code is already used
    if (db.usedCodes.includes(code)) {
        return res.json({ success: false, message: "Code already used." });
    }

    // Mark code as used
    db.usedCodes.push(code);
    saveDb();

    // Respond with success
    res.json({
        success: true,
        userId: codeEntry.userId,
        isAdmin: codeEntry.isAdmin
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});