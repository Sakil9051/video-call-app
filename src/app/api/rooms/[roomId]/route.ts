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

    const room = await Room.findOne({ roomId }).populate('participants', 'username').populate('adminId', 'username')
    
    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    return NextResponse.json({ room }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
