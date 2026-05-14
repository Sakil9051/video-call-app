import mongoose from 'mongoose'

const roomSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      unique: true,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    // Maps userId -> actual PeerJS peer ID (may differ when re-connecting)
    peerIds: {
      type: Map,
      of: String,
      default: {},
    },
  },
  { timestamps: true }
)

export const Room = mongoose.models.Room || mongoose.model('Room', roomSchema)
