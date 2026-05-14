import { NextResponse } from 'next/server'
import dbConnect from '@/lib/mongodb'
import { Room } from '@/models/Room'

export async function GET(
  request: Request,
  { params }: { params: { roomId: string } }
) {
  try {
    await dbConnect()
    const { roomId } = params

    const room = await Room.findOne({ roomId })
      .populate('participants', 'username')
      .populate('adminId', 'username')
    
    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    // Use toObject() so Mongoose Maps serialize correctly to plain objects
    const roomObj = room.toObject()
    const peerIds: Record<string, string> = roomObj.peerIds || {}

    return NextResponse.json({ room: roomObj, peerIds }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
