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

// File to store codes and user data (JSON database)
const DB_FILE = path.join(__dirname, 'codes.json');

// Initialize database
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ codes: [], users: {}, pendingSubmissions: [] }));
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

    // Check if user already has a code
    const existingCode = db.codes.find(c => c.userId === userId);
    if (existingCode) {
        bot.sendMessage(chatId, `You already have a code: **${existingCode.code}**. Use it to log in. This code is permanent until used.`);
        return;
    }

    // Generate a new code
    const code = generateCode();
    const isAdmin = userId === ADMIN_TELEGRAM_ID;

    // Store the code
    db.codes.push({ code, userId, isAdmin });

    // Initialize user balance if not exists
    if (!db.users[userId]) {
        db.users[userId] = { balance: 0, hasLoggedIn: false };
    }

    saveDb();

    // Send the code to the user
    bot.sendMessage(chatId, `Welcome to HackNet Predictor! Your login code is: **${code}**\nThis code is permanent until used.`);
});

// Telegram bot: Handle /refill command (admin only)
bot.onText(/\/refill (\d+) (\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    // Only allow admin to use this command
    if (userId !== ADMIN_TELEGRAM_ID) {
        bot.sendMessage(chatId, "You are not authorized to use this command.");
        return;
    }

    const targetUserId = match[1];
    const amount = parseInt(match[2]);

    if (!db.users[targetUserId]) {
        db.users[targetUserId] = { balance: 0, hasLoggedIn: true };
    }

    db.users[targetUserId].balance += amount;
    saveDb();

    bot.sendMessage(chatId, `Successfully added ${amount} coins to user ${targetUserId}. New balance: ${db.users[targetUserId].balance}`);
});

// Telegram bot: Handle /approve command (admin only)
bot.onText(/\/approve (\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    // Only allow admin to use this command
    if (userId !== ADMIN_TELEGRAM_ID) {
        bot.sendMessage(chatId, "You are not authorized to use this command.");
        return;
    }

    const targetUserId = match[1];
    const submission = db.pendingSubmissions.find(s => s.userId === targetUserId);

    if (!submission) {
        bot.sendMessage(chatId, `No pending submission found for user ${targetUserId}.`);
        return;
    }

    // Remove the submission and mark as approved
    db.pendingSubmissions = db.pendingSubmissions.filter(s => s.userId !== targetUserId);
    submission.approved = true;
    saveDb();

    bot.sendMessage(chatId, `Approved giveaway submission for user ${targetUserId}.`);
});

// API endpoint to validate codes
app.post('/validate-code', (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.json({ success: false, message: "Please enter a code." });
    }

    const codeEntry = db.codes.find(c => c.code === code);

    if (!codeEntry) {
        return res.json({ success: false, message: "Invalid code." });
    }

    // Check if user has already logged in with this code
    const userId = codeEntry.userId;
    if (db.users[userId].hasLoggedIn) {
        return res.json({ success: false, message: "Code already used." });
    }

    // Mark user as logged in and top up balance
    db.users[userId].hasLoggedIn = true;
    db.users[userId].balance += 50; // Top up 50 coins on first login
    db.codes = db.codes.filter(c => c.code !== code); // Remove the code after use
    saveDb();

    // Respond with success
    res.json({
        success: true,
        userId: userId,
        isAdmin: codeEntry.isAdmin,
        balance: db.users[userId].balance
    });
});

// API endpoint to get user balance
app.post('/get-balance', (req, res) => {
    const { userId } = req.body;
    if (!db.users[userId]) {
        return res.json({ success: false, message: "User not found." });
    }
    res.json({ success: true, balance: db.users[userId].balance });
});

// API endpoint to update user balance (for admin)
app.post('/update-balance', (req, res) => {
    const { userId, amount } = req.body;
    if (!db.users[userId]) {
        db.users[userId] = { balance: 0, hasLoggedIn: true };
    }
    db.users[userId].balance += amount;
    saveDb();
    res.json({ success: true, newBalance: db.users[userId].balance });
});

// API endpoint to submit giveaway link
app.post('/submit-giveaway-link', (req, res) => {
    const { userId, link } = req.body;

    if (!userId || !link) {
        return res.json({ success: false, message: "User ID and link are required." });
    }

    // Check if user already has a pending submission
    const existingSubmission = db.pendingSubmissions.find(s => s.userId === userId);
    if (existingSubmission) {
        return res.json({ success: false, message: "You have already submitted a link. Wait for admin approval." });
    }

    // Store the submission
    db.pendingSubmissions.push({ userId, link, approved: false });
    saveDb();

    // Notify admin via Telegram
    bot.sendMessage(ADMIN_TELEGRAM_ID, `User ${userId} submitted a giveaway link: ${link}\nTo approve, use: /approve ${userId}`);

    res.json({ success: true, message: "Link submitted! Awaiting admin approval." });
});

// API endpoint to check giveaway submission status
app.post('/check-giveaway-status', (req, res) => {
    const { userId } = req.body;

    const submission = db.pendingSubmissions.find(s => s.userId === userId);
    if (!submission) {
        return res.json({ success: true, submitted: false, approved: false });
    }

    res.json({ success: true, submitted: true, approved: submission.approved });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
