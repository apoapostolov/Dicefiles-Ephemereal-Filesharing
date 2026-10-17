# Hobbyfiles tracker dependency patch

Vendored from `bittorrent-tracker` 11.2.3 (MIT, original LICENSE retained).
The source and runtime API are unchanged except for the UDP server address
formatter: `lib/server/parse-udp.js` uses `lib/ip-format.cjs` instead of `ip`.
The unmaintained `ip` dependency is removed. Only its required `toString` API
is implemented locally, without the address-classification functions affected
by GHSA-2p57-rm9w-gvfp. No tracker server is started by Hobbyfiles.

The package's development dependencies and development scripts are omitted.
Update this snapshot when WebTorrent's tracker dependency removes `ip`, then
remove the root Yarn resolution. Do not modify node_modules as a substitute.
