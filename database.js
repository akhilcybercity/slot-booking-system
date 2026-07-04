require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : {
        rejectUnauthorized: true
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function initDB() {
    try {
        // Bookings table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS bookings (
                id VARCHAR(255) PRIMARY KEY,
                date VARCHAR(255) NOT NULL,
                slot_key VARCHAR(255) NOT NULL,
                status VARCHAR(255) NOT NULL,
                name VARCHAR(255),
                roll_no VARCHAR(255),
                department VARCHAR(255),
                is_under_18 TINYINT DEFAULT 0,
                duration INT DEFAULT 10,
                cancel_code VARCHAR(255),
                parent_slot VARCHAR(255)
            )
        `);

        // Settings table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                \`key\` VARCHAR(255) PRIMARY KEY,
                value TEXT NOT NULL
            )
        `);

        // Initialize default PIN if it doesn't exist
        const [pinRes] = await pool.query("SELECT value FROM settings WHERE \`key\` = 'pin'");
        if (pinRes.length === 0) {
            await pool.query("INSERT INTO settings (\`key\`, value) VALUES ('pin', '1947')");
        }

        // Users table for Admin and Staff
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                username VARCHAR(255) PRIMARY KEY,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(255) NOT NULL
            )
        `);

        // Initialize default admin
        const [adminRes] = await pool.query("SELECT username FROM users WHERE username = 'admin'");
        if (adminRes.length === 0) {
            await pool.query("INSERT INTO users (username, password, role) VALUES ('admin', 'admin123', 'admin')");
        }

        // Logs table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                username VARCHAR(255),
                action VARCHAR(255)
            )
        `);

        // Initialize closedDates array as JSON string
        const [closedDatesRes] = await pool.query("SELECT value FROM settings WHERE \`key\` = 'closedDates'");
        if (closedDatesRes.length === 0) {
            await pool.query("INSERT INTO settings (\`key\`, value) VALUES ('closedDates', '[]')");
        }

        // Initialize numComputers
        const [numCompRes] = await pool.query("SELECT value FROM settings WHERE \`key\` = 'numComputers'");
        if (numCompRes.length === 0) {
            await pool.query("INSERT INTO settings (\`key\`, value) VALUES ('numComputers', '2')");
        }

        console.log("Database initialized successfully.");
    } catch (err) {
        console.error("Database initialization error:", err);
    }
}

if (process.env.DATABASE_URL) {
    initDB();
} else {
    console.warn("WARNING: DATABASE_URL is not set. Database not initialized.");
}

module.exports = pool;
