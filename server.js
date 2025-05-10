const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Telegram bot token from environment variable
const TELEGRAM_BOT_TOKEN = "7423007718:AAF6Quzol_V7ZyXQvGlBdVWeKgBTOW_VMI4";
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Admin Telegram ID
const ADMIN_TELEGRAM_ID = "6685026718";

// File to store codes and user data (JSON database)
const DB_FILE = path.join(__dirname, 'codes.json');

// Initialize database
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ codes: [], users: {}, pendingSubmissions: [], pendingTasks: [], joinedUsers: [], tasks: [] }));
}

const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

// Save database
function saveDb() {
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
}

// Generate a unique 5-character code
function generateCode() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Telegram bot: Handle /getcode command
bot.onText(/\/getcode/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    // Check if user already has a code
    const existingCode = db.codes.find(c => c.userId === userId);
    if (existingCode) {
        try {
            await bot.sendMessage(chatId, `You already have a code: **${existingCode.code}**. Use it to log in. This code is permanent until used.`);
        } catch (error) {
            console.error('Error sending /getcode message:', error.message);
        }
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
    try {
        await bot.sendMessage(chatId, `Welcome to HackNet Predictor! Your login code is: **${code}**\nThis code is permanent until used.`);
    } catch (error) {
        console.error('Error sending /getcode response:', error.message);
    }
});

// Telegram bot: Handle /refill command (admin only)
bot.onText(/\/refill (\w+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    // Only allow admin to use this command
    if (userId !== ADMIN_TELEGRAM_ID) {
        try {
            await bot.sendMessage(chatId, "You are not authorized to use this command.");
        } catch (error) {
            console.error('Error sending /refill unauthorized message:', error.message);
        }
        return;
    }

    const code = match[1];
    const amount = parseInt(match[2]);

    const codeEntry = db.codes.find(c => c.code === code);
    if (!codeEntry) {
        try {
            await bot.sendMessage(chatId, `Code ${code} not found.`);
        } catch (error) {
            console.error('Error sending /refill code not found message:', error.message);
        }
        return;
    }

    const targetUserId = codeEntry.userId;
    if (!db.users[targetUserId]) {
        db.users[targetUserId] = { balance: 0, hasLoggedIn: true };
    }

    db.users[targetUserId].balance += amount;
    saveDb();

    try {
        await bot.sendMessage(chatId, `Successfully added ${amount} coins to user with code ${code} (Telegram ID: ${targetUserId}). New balance: ${db.users[targetUserId].balance}`);
    } catch (error) {
        console.error('Error sending /refill success message:', error.message);
    }
});

// Telegram bot: Handle /accept command (admin only)
bot.onText(/\/accept (\w+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    // Only allow admin to use this command
    if (userId !== ADMIN_TELEGRAM_ID) {
        try {
            await bot.sendMessage(chatId, "You are not authorized to use this command.");
        } catch (error) {
            console.error('Error sending /accept unauthorized message:', error.message);
        }
        return;
    }

    const code = match[1];
    const codeEntry = db.codes.find(c => c.code === code);
    if (!codeEntry) {
        try {
            await bot.sendMessage(chatId, `Code ${code} not found.`);
        } catch (error) {
            console.error('Error sending /accept code not found message:', error.message);
        }
        return;
    }

    const targetUserId = codeEntry.userId;

    // Check for pending giveaway submission
    const submission = db.pendingSubmissions.find(s => s.userId === targetUserId);
    if (submission) {
        db.pendingSubmissions = db.pendingSubmissions.filter(s => s.userId !== targetUserId);
        submission.approved = true;
        db.users[targetUserId].balance += 20; // Add 20 coins for giveaway approval
        saveDb();
        try {
            await bot.sendMessage(chatId, `Approved giveaway submission for user with code ${code} (Telegram ID: ${targetUserId}). They received 20 coins. New balance: ${db.users[targetUserId].balance}`);
        } catch (error) {
            console.error('Error sending /accept giveaway approval message:', error.message);
        }
        return;
    }

    // Check for pending task submission
    const taskSubmission = db.pendingTasks.find(t => t.userId === targetUserId);
    if (taskSubmission) {
        db.pendingTasks = db.pendingTasks.filter(t => t.userId !== targetUserId);
        const taskKey = `${targetUserId}_${taskSubmission.taskIndex}`;
        const now = Date.now();
        const taskEntry = db.tasks.find(t => t.key === taskKey);
        if (taskEntry) {
            taskEntry.lockUntil = now + 60 * 60 * 1000; // 1 hour lock
        } else {
            db.tasks.push({ key: taskKey, userId: targetUserId, taskIndex: taskSubmission.taskIndex, lockUntil: now + 60 * 60 * 1000 });
        }
        db.users[targetUserId].balance += 20; // Add 20 coins for task approval
        saveDb();
        try {
            await bot.sendMessage(chatId, `Approved earn task for user with code ${code} (Telegram ID: ${targetUserId}). They received 20 coins. New balance: ${db.users[targetUserId].balance}`);
        } catch (error) {
            console.error('Error sending /accept task approval message:', error.message);
        }
        return;
    }

    try {
        await bot.sendMessage(chatId, `No pending submission or task found for user with code ${code} (Telegram ID: ${targetUserId}).`);
    } catch (error) {
        console.error('Error sending /accept no submission message:', error.message);
    }
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

    // Add user to joined users list if not already present
    if (!db.joinedUsers.includes(userId)) {
        db.joinedUsers.push(userId);
    }

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
    const { code, amount } = req.body;

    const codeEntry = db.codes.find(c => c.code === code);
    if (!codeEntry) {
        return res.json({ success: false, message: "Code not found." });
    }

    const userId = codeEntry.userId;
    if (!db.users[userId]) {
        db.users[userId] = { balance: 0, hasLoggedIn: true };
    }
    db.users[userId].balance += amount;
    saveDb();
    res.json({ success: true, newBalance: db.users[userId].balance });
});

// API endpoint to submit giveaway link
app.post('/submit-giveaway-link', async (req, res) => {
    const { userId, link } = req.body;

    if (!userId || !link) {
        return res.json({ success: false, message: "User ID and link are required." });
    }

    // Check if user already has a pending submission
    const existingSubmission = db.pendingSubmissions.find(s => s.userId === userId);
    if (existingSubmission) {
        return res.json({ success: false, message: "You have already submitted a link. Wait for admin approval." });
    }

    // Find the user's code
    const codeEntry = db.codes.find(c => c.userId === userId);
    const code = codeEntry ? codeEntry.code : "Unknown";

    // Store the submission
    db.pendingSubmissions.push({ userId, link, approved: false });
    saveDb();

    // Notify admin via Telegram
    try {
        await bot.sendMessage(ADMIN_TELEGRAM_ID, `User with code ${code} (Telegram ID: ${userId}) submitted a giveaway link: ${link}\nTo accept, use: /accept ${code}`);
        res.json({ success: true, message: "Link submitted! Awaiting admin approval." });
    } catch (error) {
        console.error('Error sending giveaway link notification:', error.message);
        res.json({ success: true, message: "Link submitted, but failed to notify admin via Telegram." });
    }
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

// API endpoint to get joined users count
app.get('/joined-users-count', (req, res) => {
    res.json({ count: db.joinedUsers.length });
});

// API endpoint to submit a task
app.post('/submit-task', async (req, res) => {
    const { userId, taskIndex, url } = req.body;

    if (!userId || taskIndex === undefined || !url) {
        return res.json({ success: false, message: "User ID, task index, and URL are required." });
    }

    // Check if user already has a pending task submission for this task
    const existingTask = db.pendingTasks.find(t => t.userId === userId && t.taskIndex === taskIndex);
    if (existingTask) {
        return res.json({ success: false, message: "You have already submitted this task. Wait for admin approval." });
    }

    // Find the user's code
    const codeEntry = db.codes.find(c => c.userId === userId);
    const code = codeEntry ? codeEntry.code : "Unknown";

    // Store the task submission
    db.pendingTasks.push({ userId, taskIndex, url, approved: false });
    saveDb();

    // Notify admin via Telegram
    try {
        await bot.sendMessage(ADMIN_TELEGRAM_ID, `User with code ${code} (Telegram ID: ${userId}) submitted an earn task (Task ${taskIndex + 1}): ${url}\nTo accept, use: /accept ${code}`);
        res.json({ success: true, message: "Task submitted! Awaiting admin approval." });
    } catch (error) {
        console.error('Error sending task submission notification:', error.message);
        res.json({ success: true, message: "Task submitted, but failed to notify admin via Telegram." });
    }
});

// API endpoint to check task status
app.post('/get-task-status', (req, res) => {
    const { userId, taskIndex } = req.body;

    const taskKey = `${userId}_${taskIndex}`;
    const taskEntry = db.tasks.find(t => t.key === taskKey);
    const pendingTask = db.pendingTasks.find(t => t.userId === userId && t.taskIndex === taskIndex);

    if (pendingTask) {
        res.json({ submitted: true, approved: pendingTask.approved, lockUntil: 0 });
    } else if (taskEntry) {
        res.json({ submitted: false, approved: true, lockUntil: taskEntry.lockUntil });
    } else {
        res.json({ submitted: false, approved: false, lockUntil: 0 });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
