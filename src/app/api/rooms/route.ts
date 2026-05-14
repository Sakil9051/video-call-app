import { NextResponse } from 'next/server'
import dbConnect from '@/lib/mongodb'
import { Room } from '@/models/Room'
import { verifyToken } from '@/lib/auth'

export async function POST(request: Request) {
  try {
    const token = request.headers.get('cookie')?.split('auth_token=')[1]?.split(';')[0]
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    
    const payload = await verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    await dbConnect()
    const { roomId } = await request.json()

    if (!roomId) {
      return NextResponse.json({ error: 'Room ID is required' }, { status: 400 })
    }

    const existingRoom = await Room.findOne({ roomId })
    if (existingRoom) {
      // Just reuse if the creator is the admin, or return error
      if (existingRoom.adminId.toString() === payload.userId) {
         return NextResponse.json({ room: existingRoom }, { status: 200 })
      }
      return NextResponse.json({ error: 'Room already exists' }, { status: 400 })
    }

    const newRoom = await Room.create({
      roomId,
      adminId: payload.userId,
      participants: [payload.userId], // Creator is automatically a participant
    })

    return NextResponse.json({ room: newRoom }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
