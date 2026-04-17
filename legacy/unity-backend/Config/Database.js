module.exports = {
    connectionType: process.env.DB_CONNECTION_TYPE || 'production',
    option: {
        autoIndex: false, // Don't build indexes
        maxPoolSize: 10, // Maintain up to 10 socket connections
        useNewUrlParser: true,
    },
    mode: process.env.DB_MODE || 'local',
    // If MONGO_URI is set (e.g. MongoDB Atlas), use it directly
    mongoUri: process.env.MONGO_URI || null,
    mongo: {
        host: process.env.MONGO_HOST || 'localhost',
        port: parseInt(process.env.MONGO_PORT, 10) || 27017,
        user: process.env.MONGO_USER || '',
        password: process.env.MONGO_PASSWORD || '',
        database: process.env.MONGO_DATABASE || 'bingo_game'
    }
}