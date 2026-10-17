# TCP-only torrent runtime

Hobbyfiles uses WebTorrent only on the server, with guarded public TCP peers.
WebRTC tracker discovery, WebRTC peers, incoming peers and web seeds are disabled.
WebTorrent still imports `simple-peer`, which otherwise eagerly loads the native
`node-datachannel` WebRTC addon even when WebRTC will never be used.

This small application-owned adapter reports WebRTC as unavailable through the
three exports used by `simple-peer`. The dependency's normal capability check
then sets `WEBRTC_SUPPORT=false`. It implements no transport and supplies no
fallback connection. Actual torrent piece transfer continues through WebTorrent's
TCP connection pool.

The Yarn resolution removes the unnecessary native addon and its installation
toolchain. A Windows-installed addon can no longer break the WSL test service
with an invalid ELF header, and container builds do not need that addon either.
This adapter is specific to Hobbyfiles' server policy; it is not a general
replacement for a WebRTC implementation.
