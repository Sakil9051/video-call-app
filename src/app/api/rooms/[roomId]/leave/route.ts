import { NextResponse } from 'next/server'
import dbConnect from '@/lib/mongodb'
import { Room } from '@/models/Room'
import { verifyToken } from '@/lib/auth'

export async function POST(
  request: Request,
  { params }: { params: { roomId: string } }
) {
  try {
    const token = request.headers.get('cookie')?.split('auth_token=')[1]?.split(';')[0]
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    
    const payload = await verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    await dbConnect()
    const { roomId } = params

    const room = await Room.findOne({ roomId })
    
    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    // Remove user from participants
    room.participants = room.participants.filter(
      (p: any) => p.toString() !== payload.userId
    )

    if (room.participants.length === 0) {
      // If room is empty, we can optionally delete it
      await Room.deleteOne({ roomId })
      return NextResponse.json({ message: 'Room deleted' }, { status: 200 })
    } else {
      // Reassign admin if the leaving user was the admin
      if (room.adminId.toString() === payload.userId) {
        room.adminId = room.participants[0] // pick the first remaining person
      }
      await room.save()
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
