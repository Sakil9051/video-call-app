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

    // Add user to participants if not already there
    if (!room.participants.includes(payload.userId)) {
      room.participants.push(payload.userId)
      await room.save()
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
