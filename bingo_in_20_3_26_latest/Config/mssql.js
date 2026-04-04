const sql = require('mssql');
require('dotenv').config();
const config = {
    user: process.env.MSSQL_DB_USERNAME,
    password: process.env.MSSQL_DB_PASSWORD,
    server: process.env.MSSQL_DB_SERVER,
    database: process.env.MSSQL_DB_DATABASE,
    port: parseInt(process.env.MSSQL_DB_PORT, 10),
    options: {
        encrypt: true, // Use encryption for Azure SQL or if required
        trustServerCertificate: true, // For development use only; disable in production
        connectTimeout: 15000, // 15 second connect timeout
        requestTimeout: 30000, // 30 second request timeout
    },
    pool: {
        max: 10, // Maximum number of connections
        min: 0, // Minimum number of connections
        idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
    },
};

let poolPromise;

// Initialize MSSQL Connection
const connectToDatabase = async () => {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        console.log('Connected to MSSQL');
        return pool;
      })
      .catch((err) => {
        console.error('MSSQL Connection Failed:', err.code || err.message || err);
        if (err.code === 'ESOCKET' || err.code === 'ETIMEOUT') {
          console.error('MSSQL hint: Server %s:%s is unreachable. Check firewall/whitelist for Render IPs.',
            process.env.MSSQL_DB_SERVER, process.env.MSSQL_DB_PORT);
        }
        poolPromise = null; // Reset poolPromise to allow retries
        setTimeout(connectToDatabase, 60000); // Retry after 1 minute
      });
  }
  return poolPromise;
};
connectToDatabase();

module.exports = {
  sql, // Export sql to use directly for queries or requests
  poolPromise, // Export function to connect to the database
};