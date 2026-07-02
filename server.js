const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to check admin PIN
const checkAdminPin = (req, res, next) => {
    const providedPin = req.headers['x-admin-pin'];
    db.get("SELECT value FROM settings WHERE key = 'pin'", (err, row) => {
        if (err) return res.status(500).json({ error: "Database error" });
        if (row && row.value === providedPin) {
            next();
        } else {
            res.status(401).json({ error: "Unauthorized. Invalid PIN." });
        }
    });
};

// --- Settings Routes ---

app.get('/api/settings', (req, res) => {
    db.all("SELECT key, value FROM settings", (err, rows) => {
        if (err) return res.status(500).json({ error: "Database error" });
        
        const settings = {};
        rows.forEach(row => {
            if (row.key === 'closedDates') {
                settings[row.key] = JSON.parse(row.value);
            } else {
                settings[row.key] = row.value;
            }
        });
        
        // Don't send PIN to unauthenticated users unless they specifically need it
        // Actually, the frontend checks if entered PIN matches the saved PIN locally currently. 
        // We shouldn't send the PIN in a public GET request. We should change frontend auth to 
        // make an API call to verify the PIN instead.
        // For now, to keep frontend changes minimal, we can return it, but it's insecure.
        // Let's create a specific login endpoint instead.
        const responseSettings = { closedDates: settings.closedDates };
        res.json(responseSettings);
    });
});

app.post('/api/admin/login', (req, res) => {
    const { pin } = req.body;
    db.get("SELECT value FROM settings WHERE key = 'pin'", (err, row) => {
        if (err) return res.status(500).json({ error: "Database error" });
        if (row && row.value === pin) {
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false });
        }
    });
});

app.post('/api/settings/pin', checkAdminPin, (req, res) => {
    const { newPin } = req.body;
    if (!newPin) return res.status(400).json({ error: "New PIN required" });
    
    db.run("UPDATE settings SET value = ? WHERE key = 'pin'", [newPin], function(err) {
        if (err) return res.status(500).json({ error: "Database error" });
        res.json({ success: true });
    });
});

app.post('/api/settings/holidays', checkAdminPin, (req, res) => {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: "Date required" });

    db.get("SELECT value FROM settings WHERE key = 'closedDates'", (err, row) => {
        if (err) return res.status(500).json({ error: "Database error" });
        let closedDates = JSON.parse(row.value);
        if (!closedDates.includes(date)) {
            closedDates.push(date);
            db.run("UPDATE settings SET value = ? WHERE key = 'closedDates'", [JSON.stringify(closedDates)], function(err) {
                if (err) return res.status(500).json({ error: "Database error" });
                res.json({ success: true, closedDates });
            });
        } else {
            res.json({ success: true, closedDates });
        }
    });
});

app.delete('/api/settings/holidays/:date', checkAdminPin, (req, res) => {
    const { date } = req.params;
    db.get("SELECT value FROM settings WHERE key = 'closedDates'", (err, row) => {
        if (err) return res.status(500).json({ error: "Database error" });
        let closedDates = JSON.parse(row.value);
        closedDates = closedDates.filter(d => d !== date);
        db.run("UPDATE settings SET value = ? WHERE key = 'closedDates'", [JSON.stringify(closedDates)], function(err) {
            if (err) return res.status(500).json({ error: "Database error" });
            res.json({ success: true, closedDates });
        });
    });
});

// --- Booking Routes ---

app.get('/api/bookings/:date', (req, res) => {
    const { date } = req.params;
    db.all("SELECT * FROM bookings WHERE date = ?", [date], (err, rows) => {
        if (err) return res.status(500).json({ error: "Database error" });
        
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
    });
});

app.post('/api/bookings', (req, res) => {
    const { date, slot_key, name, rollNo, department, isUnder18, duration, cancelCode, continuedSlotKey } = req.body;
    
    // In a real app, we'd use a transaction here. For SQLite, we can just run sequentially,
    // but check for conflicts first.
    db.get("SELECT id FROM bookings WHERE date = ? AND slot_key = ?", [date, slot_key], (err, row) => {
        if (err) return res.status(500).json({ error: "Database error" });
        if (row) return res.status(409).json({ error: "Slot already booked" });
        
        const id1 = `${date}_${slot_key}`;
        
        db.run(
            "INSERT INTO bookings (id, date, slot_key, status, name, roll_no, department, is_under_18, duration, cancel_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [id1, date, slot_key, 'booked', name, rollNo, department, isUnder18 ? 1 : 0, duration, cancelCode],
            function(err) {
                if (err) return res.status(500).json({ error: "Failed to book" });
                
                if (isUnder18 && continuedSlotKey) {
                    const id2 = `${date}_${continuedSlotKey}`;
                    db.run(
                        "INSERT INTO bookings (id, date, slot_key, status, parent_slot) VALUES (?, ?, ?, ?, ?)",
                        [id2, date, continuedSlotKey, 'continued', slot_key],
                        function(err2) {
                            if (err2) console.error("Failed to book continued slot", err2);
                            res.json({ success: true });
                        }
                    );
                } else {
                    res.json({ success: true });
                }
            }
        );
    });
});

app.post('/api/bookings/cancel', (req, res) => {
    const { date, slot_key, code } = req.body;
    
    db.get("SELECT cancel_code, duration FROM bookings WHERE date = ? AND slot_key = ?", [date, slot_key], (err, row) => {
        if (err) return res.status(500).json({ error: "Database error" });
        if (!row) return res.status(404).json({ error: "Booking not found" });
        
        if (row.cancel_code === code) {
            db.run("DELETE FROM bookings WHERE date = ? AND (slot_key = ? OR parent_slot = ?)", [date, slot_key, slot_key], function(err) {
                if (err) return res.status(500).json({ error: "Failed to cancel" });
                res.json({ success: true });
            });
        } else {
            res.status(401).json({ error: "Incorrect cancellation code" });
        }
    });
});

app.post('/api/admin/free', checkAdminPin, (req, res) => {
    const { date, slot_key } = req.body;
    db.run("DELETE FROM bookings WHERE date = ? AND (slot_key = ? OR parent_slot = ?)", [date, slot_key, slot_key], function(err) {
        if (err) return res.status(500).json({ error: "Failed to cancel" });
        res.json({ success: true });
    });
});


app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
