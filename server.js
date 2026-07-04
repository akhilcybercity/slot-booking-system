const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database'); 

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const crypto = require('crypto');

// In-memory token store (token -> { username, role })
const activeTokens = {};

const authenticateToken = (req, res, next) => {
    const token = req.headers['x-auth-token'];
    if (token && activeTokens[token]) {
        req.user = activeTokens[token];
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

const checkAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Forbidden. Admin only.' });
    }
};

// Helper for logging actions
const logAction = async (username, action) => {
    try {
        await db.query("INSERT INTO logs (username, action) VALUES (?, ?)", [username, action]);
    } catch (err) {
        console.error("Logging error", err);
    }
};

// --- Settings Routes ---

app.get('/api/settings', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT \`key\`, value FROM settings");
        const settings = {};
        rows.forEach(row => {
            if (row.key === 'closedDates') {
                settings[row.key] = JSON.parse(row.value);
            } else {
                settings[row.key] = row.value;
            }
        });
        
        const responseSettings = { closedDates: settings.closedDates };
        res.json(responseSettings);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing credentials" });
    
    try {
        const [rows] = await db.query("SELECT username, role FROM users WHERE username = ? AND password = ?", [username, password]);
        const row = rows[0];
        if (row) {
            const token = crypto.randomBytes(32).toString('hex');
            activeTokens[token] = { username: row.username, role: row.role };
            await logAction(row.username, 'Login successful');
            res.json({ success: true, token, role: row.role, username: row.username });
        } else {
            res.status(401).json({ error: "Invalid credentials" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

app.post('/api/auth/logout', authenticateToken, (req, res) => {
    const token = req.headers['x-auth-token'];
    if (token) delete activeTokens[token];
    res.json({ success: true });
});

app.put('/api/auth/password', authenticateToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ error: "Missing required fields" });
    
    try {
        const [rows] = await db.query("SELECT password FROM users WHERE username = ?", [req.user.username]);
        if (rows.length === 0 || rows[0].password !== oldPassword) {
            return res.status(401).json({ error: "Incorrect current password" });
        }
        
        await db.query("UPDATE users SET password = ? WHERE username = ?", [newPassword, req.user.username]);
        await logAction(req.user.username, 'Changed password');
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

// Admin: Manage Staff
app.get('/api/admin/staff', authenticateToken, checkAdmin, async (req, res) => {
    try {
        const [rows] = await db.query("SELECT username, role FROM users WHERE role = 'staff'");
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

app.post('/api/admin/staff', authenticateToken, checkAdmin, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing details" });
    
    try {
        await db.query("INSERT INTO users (username, password, role) VALUES (?, ?, 'staff')", [username, password]);
        await logAction(req.user.username, `Created staff account: ${username}`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: "User already exists or DB error" });
    }
});

app.delete('/api/admin/staff/:username', authenticateToken, checkAdmin, async (req, res) => {
    const { username } = req.params;
    try {
        await db.query("DELETE FROM users WHERE username = ? AND role = 'staff'", [username]);
        await logAction(req.user.username, `Deleted staff account: ${username}`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

// Admin: View Logs
app.get('/api/admin/logs', authenticateToken, checkAdmin, async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, timestamp, username, action FROM logs ORDER BY id DESC LIMIT 100");
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

app.post('/api/settings/holidays', authenticateToken, checkAdmin, async (req, res) => {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: "Date required" });

    try {
        const [rows] = await db.query("SELECT value FROM settings WHERE \`key\` = 'closedDates'");
        const row = rows[0];
        let closedDates = row ? JSON.parse(row.value) : [];
        if (!closedDates.includes(date)) {
            closedDates.push(date);
            await db.query("UPDATE settings SET value = ? WHERE \`key\` = 'closedDates'", [JSON.stringify(closedDates)]);
        }
        res.json({ success: true, closedDates });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

app.delete('/api/settings/holidays/:date', authenticateToken, checkAdmin, async (req, res) => {
    const { date } = req.params;
    try {
        const [rows] = await db.query("SELECT value FROM settings WHERE \`key\` = 'closedDates'");
        const row = rows[0];
        if (row) {
            let closedDates = JSON.parse(row.value);
            closedDates = closedDates.filter(d => d !== date);
            await db.query("UPDATE settings SET value = ? WHERE \`key\` = 'closedDates'", [JSON.stringify(closedDates)]);
            res.json({ success: true, closedDates });
        } else {
            res.json({ success: true, closedDates: [] });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

// --- Booking Routes ---

app.get('/api/bookings/:date', async (req, res) => {
    const { date } = req.params;
    try {
        const [rows] = await db.query("SELECT * FROM bookings WHERE date = ?", [date]);
        const dayData = {};
        rows.forEach(row => {
            dayData[row.slot_key] = {
                status: row.status,
                name: row.name,
                rollNo: row.roll_no,
                department: row.department,
                isUnder18: !!row.is_under_18,
                duration: row.duration,
                cancelCode: row.cancel_code,
                parentSlot: row.parent_slot
            };
        });
        res.json(dayData);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

app.get('/api/staff/roster/:date', authenticateToken, async (req, res) => {
    const { date } = req.params;
    await logAction(req.user.username, `Viewed/Exported roster for ${date}`);
    
    try {
        const [rows] = await db.query("SELECT * FROM bookings WHERE date = ?", [date]);
        const dayData = {};
        rows.forEach(row => {
            dayData[row.slot_key] = {
                status: row.status,
                name: row.name,
                rollNo: row.roll_no,
                department: row.department,
                isUnder18: !!row.is_under_18,
                duration: row.duration,
                cancelCode: row.cancel_code,
                parentSlot: row.parent_slot
            };
        });
        res.json(dayData);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

app.post('/api/bookings', async (req, res) => {
    const { date, slot_key, name, rollNo, department, isUnder18, duration, cancelCode, continuedSlotKey } = req.body;
    
    try {
        const [checkRows] = await db.query("SELECT id FROM bookings WHERE date = ? AND slot_key = ?", [date, slot_key]);
        if (checkRows.length > 0) return res.status(409).json({ error: "Slot already booked" });
        
        const id1 = `${date}_${slot_key}`;
        
        await db.query(
            "INSERT INTO bookings (id, date, slot_key, status, name, roll_no, department, is_under_18, duration, cancel_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [id1, date, slot_key, 'booked', name, rollNo, department, isUnder18 ? 1 : 0, duration, cancelCode]
        );
                
        if (isUnder18 && continuedSlotKey) {
            const id2 = `${date}_${continuedSlotKey}`;
            try {
                await db.query(
                    "INSERT INTO bookings (id, date, slot_key, status, parent_slot) VALUES (?, ?, ?, ?, ?)",
                    [id2, date, continuedSlotKey, 'continued', slot_key]
                );
            } catch (err2) {
                console.error("Failed to book continued slot", err2);
            }
        } 
        res.json({ success: true });
        
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to book" });
    }
});

app.post('/api/bookings/cancel', async (req, res) => {
    const { date, slot_key, code } = req.body;
    
    try {
        const [rows] = await db.query("SELECT cancel_code, duration FROM bookings WHERE date = ? AND slot_key = ?", [date, slot_key]);
        const row = rows[0];
        if (!row) return res.status(404).json({ error: "Booking not found" });
        
        if (row.cancel_code === code) {
            await db.query("DELETE FROM bookings WHERE date = ? AND (slot_key = ? OR parent_slot = ?)", [date, slot_key, slot_key]);
            res.json({ success: true });
        } else {
            res.status(401).json({ error: "Incorrect cancellation code" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to cancel" });
    }
});

app.post('/api/admin/free', authenticateToken, checkAdmin, async (req, res) => {
    const { date, slot_key } = req.body;
    try {
        await db.query("DELETE FROM bookings WHERE date = ? AND (slot_key = ? OR parent_slot = ?)", [date, slot_key, slot_key]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to cancel" });
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
