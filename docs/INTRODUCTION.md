# Introduction to Dicefiles

Dicefiles is a self-hosted, open-source file sharing platform built specifically for hobby communities. It provides real-time chat rooms with file sharing capabilities, perfect for groups sharing roleplaying books, digital maps, board games, 3D models (STL), fiction, and other hobby resources.

## Purpose

Unlike general-purpose file hosts, Dicefiles focuses on ephemeral, community-driven sharing. Files are stored temporarily (configurable TTL) and automatically deleted when expired, keeping the platform lightweight and focused on active sharing sessions.

## What Makes Dicefiles Different?

### Self-Hosted & Privacy-First

- You host your own instance - no third-party data collection
- Chat history is stored locally in browsers, not on servers
- Minimal logging with clear privacy policies
- You control your data and who accesses it

### Built for Hobbyists

- Designed for the specific needs of hobby communities (RPG groups, board gamers, makers)
- File type previews for common hobby formats (PDFs, images, 3D models)
- Room-based sharing that feels like a clubhouse or game store table

### Ephemeral by Design

- Files have configurable expiration times (default: 48 hours)
- Encourages active sharing rather than permanent file dumps
- Reduces storage requirements and keeps content fresh

## Key Use Cases

### Roleplaying Game Groups

- Share rulebooks, character sheets, and campaign materials
- Distribute maps and battle grids
- Share audio recordings of game sessions
- Exchange PDFs of supplements and modules

### Board Game Communities

- Upload rulebooks and errata PDFs
- Share print-and-play materials
- Distribute custom game designs
- Post photos of custom boards and pieces

### Makers & 3D Printers

- Share STL files for 3D printing
- Upload GCODE and slicing profiles
- Exchange project files and modifications
- Share photos of completed prints

### Fiction & Creative Writing Groups

- Share manuscripts and draft chapters
- Distribute character bibles and worldbuilding docs
- Exchange cover art and illustrations
- Share audio readings and voice drafts

## Getting Started

### For Users

1. **Join a Room**: Navigate to `/r/room-name` to join an existing room
2. **Create a Room**: Visit `/new` to create your own room with a custom name
3. **Upload Files**: Drag files into your room or use the upload button
4. **Chat**: Real-time messaging with all room participants
5. **Register (Optional)**: Create an account to keep your nickname and access moderation tools

### For Room Owners

1. **Create a Room**: Use `/new` to create a room with your desired name
2. **Moderate**: As room owner, you can:
   - Delete files in your room
   - Kick users from your room
   - Set local rules for your community
3. **Manage**: Room files automatically expire based on TTL settings

### For Server Hosts

See the main [README](README.md) for complete installation and setup instructions.

## Room Features

### File Sharing

- **Multiple file uploads**: Share multiple files at once
- **File previews**: See thumbnails for images, videos, and PDFs
- **File details**: File size, type, and uploader info
- **Download tracking**: See who's downloading your files
- **NEW badges**: Recently added unseen files/requests are marked with `NEW!`
- **Batch downloads**: Download all files or only NEW files with progress feedback

### Request System

- **Create requests in-room**: Ask others to upload specific content from the room toolbar
- **Request list integration**: Requests appear directly in file list flow with dedicated styling
- **Optional reference link**: Attach a URL to a product/page relevant to the request
- **Optional request image**: Attach a visual reference/cover image shown in hover preview
- **Request filtering**: Filter strip includes a request-only filter for faster browsing

### Chat System

- **Real-time messaging**: Instant chat with all room participants
- **User nicknames**: Optional registration to keep your name
- **Room history**: Chat stored locally in browser for persistence
- **Emotes and formatting**: Rich text chat with emoji support

### Moderation

- **Room ownership**: Room owners have moderation tools
- **Platform moderation**: Global moderators handle rule violations
- **Report system**: Flag inappropriate content or behavior
- **Message removal**: Moderators can remove problematic messages
- **Self-service cleanup**: Regular users can remove their own uploads/requests, while owners/moderators can remove any

## Configuration

Dicefiles is highly configurable via `.config.json`:

```json
{
  "name": "Dicefiles",
  "motto": "Ephemereal Filesharing for Hobby Communities",
  "port": 9090,
  "maxFileSize": 10737418240,
  "TTL": 48,
  "requireAccounts": false,
  "roomCreation": true,
  "jail": false
}
```

### Key Options

- **port**: HTTP listen port (default: 8080)
- **maxFileSize**: Maximum file upload size in bytes (default: 10GB)
- **TTL**: Hours before files expire (default: 48)
- **requireAccounts**: Require accounts to chat/upload (default: false)
- **roomCreation**: Allow creating new rooms (default: true)
- **jail**: Use firejail for preview commands (Linux only, default: true)

See `defaults.js` for all available options.

## Community Guidelines

Dicefiles is built for hobby communities to share resources legally and respectfully. Key principles:

1. **Respect Copyright**: Only share content you have the right to distribute
2. **Be Civil**: Treat other community members with respect
3. **Follow Local Rules**: Room owners may set additional rules
4. **Report Issues**: Use moderation tools to flag inappropriate content

See the full [Rules](rules) and [Terms of Service](terms) for complete guidelines.

## Contributing

Dicefiles is open source and welcomes contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Support & Resources

- **GitHub Repository**: https://github.com/apoapostolov/Dicefiles-Ephemereal-Filesharing
- **X/Twitter**: https://x.com/apoapostolov
- **Issues**: Report bugs and request features via GitHub Issues

## License

MIT License - See LICENSE file for details.
