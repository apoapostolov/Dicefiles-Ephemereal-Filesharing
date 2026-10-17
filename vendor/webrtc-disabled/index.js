"use strict";

// The server accepts only validated TCP peers. Exporting no WebRTC capability
// lets simple-peer report WEBRTC_SUPPORT=false without loading a platform
// native module that the playback policy never uses.
export const RTCPeerConnection = undefined;
export const RTCSessionDescription = undefined;
export const RTCIceCandidate = undefined;
