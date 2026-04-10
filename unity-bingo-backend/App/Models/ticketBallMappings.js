const mongoose = require("mongoose");

const TicketBallMappingSchema = new mongoose.Schema({
    gameId: { type: String, required: true, index: true }, // Reference to the game
    ballNumber: { type: Number, required: true, index: true }, // The drawn ball number
    tickets: [
        {
            ticketId: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket", required: true }, // Reference to ticket
            position: { type: String, required: true } // Position in the format "row:col"
        }
    ]
}, { timestamps: true, versionKey: false, collection: "TicketBallMappings" });

// Compound index for fast lookups
TicketBallMappingSchema.index({ gameId: 1, ballNumber: 1 });

// Prevent _id in subdocuments
TicketBallMappingSchema.path("tickets").schema.set("_id", false);
module.exports = mongoose.model("TicketBallMapping", TicketBallMappingSchema);
