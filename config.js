const os = require('os');

module.exports = {
  listenIp: '0.0.0.0',
  listenPort: 3001,

  mediasoup: {
    // Worker settings
    numWorkers: Object.keys(os.cpus()).length,
    workerSettings: {
      logLevel: 'warn',
      logTags: [
        'info',
        'ice',
        'dtls',
        'rtp',
        'srtp',
        'rtcp',
      ],
      rtcMinPort: 10000,
      rtcMaxPort: 10100,
    },
    // Router settings
    routerOptions: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000,
          },
        },
      ],
    },
    // WebRtcTransport settings
    webRtcTransportOptions: {
      listenIps: [
        {
          ip: '0.0.0.0',
          announcedIp: process.env.ANNOUNCED_IP || undefined, // Set this in Render env vars if you have a public IP
        },
      ],
      enableUdp: process.env.NODE_ENV === 'production' ? false : true, // UDP is blocked on Render Web Services
      enableTcp: true,
      preferUdp: process.env.NODE_ENV === 'production' ? false : true,
      preferTcp: process.env.NODE_ENV === 'production' ? true : false,
    },
  },
};
