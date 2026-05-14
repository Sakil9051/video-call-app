# PeerConnect

PeerConnect is a blazing fast, peer-to-peer video calling platform built with Next.js, WebRTC, and MongoDB. Create a room instantly, share the code, and start talking securely in high definition with your friends or colleagues—no downloads required.

## Features

- **Secure P2P Video & Audio**: Direct peer-to-peer connections mean minimal latency and crystal clear video quality. Your streams are encrypted end-to-end between peers without middleman servers.
- **Multi-User Rooms**: Invite multiple friends or colleagues into a dynamic full-mesh video grid that scales seamlessly.
- **Authentication**: Secure JWT-based account system. Users must be logged in to create or join a room.
- **Smart Admin Controls**: The room creator is automatically assigned as the admin. If the admin leaves, the system automatically assigns a new admin from the remaining participants.
- **Modern UI**: Stunning glassmorphism design with a dynamic hero landing page, responsive grids, and an intuitive user experience.
- **No Downloads**: Works directly in your modern web browser.

## Tech Stack

- **Frontend**: Next.js 14, React 18, Custom CSS (Glassmorphism aesthetics)
- **WebRTC**: PeerJS for seamless peer-to-peer connection management
- **Backend/API**: Next.js App Router API Routes
- **Database**: MongoDB & Mongoose
- **Authentication**: JWT (JSON Web Tokens) using `jose` and `bcryptjs`

## Prerequisites

Before you begin, ensure you have the following installed:
- Node.js (v18 or higher recommended)
- A MongoDB cluster (e.g., MongoDB Atlas)

## Environment Variables

Create a `.env.local` file in the root directory and add the following variables:

```env
# Your MongoDB connection string
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/<database>?retryWrites=true&w=majority

# Secret key for JWT authentication
JWT_SECRET=your_super_secret_jwt_key_here
```

## Installation & Setup

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```
   *Note: Our custom `predev` script will automatically verify your MongoDB connection before starting the server to ensure everything is configured correctly.*

3. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## How It Works

1. **Create an Account**: Sign up in seconds from the landing page.
2. **Generate a Room**: Click 'Create Room' to generate a unique, secure 6-character code.
3. **Share & Connect**: Share the code with anyone. They just paste it in and instantly join your call!

## License

This project is open-source and available under the MIT License.
