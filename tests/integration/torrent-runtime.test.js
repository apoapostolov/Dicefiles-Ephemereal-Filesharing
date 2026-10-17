"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("the installed TCP torrent engine starts and transfers verified byte ranges using the production piece store", () => {
  const script = `
    import fs from 'node:fs';
    import os from 'node:os';
    import path from 'node:path';
    import vm from 'node:vm';
    import {createRequire} from 'node:module';
    const local = createRequire(path.join(process.cwd(), 'lib/media/torrent-stream.js'));
    const {default: WebTorrent} = await import('webtorrent');
    const {default: Peer} = await import('@thaunknown/simple-peer/lite.js');
    if (Peer.WEBRTC_SUPPORT) throw new Error('Native WebRTC must be disabled for the TCP-only runtime');
    const moduleUnderTest = {exports:{}};
    vm.compileFunction(fs.readFileSync('lib/media/torrent-stream.js','utf8'), ['require','module'])(name => name.startsWith('../') ? {} : local(name), moduleUnderTest);
    const {PieceStore} = moduleUnderTest.exports;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hobbyfiles-tcp-test-'));
    const options = {dht:false,tracker:false,lsd:false,utPex:false,natUpnp:false,natPmp:false,utp:false,webSeeds:false};
    const seeder = new WebTorrent(options);
    const reader = new WebTorrent(options);
    const payload = Buffer.alloc(32791);
    for (let i=0;i<payload.length;i++) payload[i]=i%251;
    let timer;
    try {
      await Promise.race([
        new Promise((resolve,reject) => {
          seeder.on('error',reject); reader.on('error',reject);
          seeder.seed(payload,{name:'synthetic.bin',announce:[],pieceLength:16384,path:dir},source => {
            const torrent = reader.add(source.torrentFile,{path:dir,store:PieceStore,storeCacheSlots:0,deselect:true,uploads:false});
            torrent.on('error',reject);
            torrent.once('ready',async () => {
              try {
                torrent.addPeer('127.0.0.1:'+seeder.torrentPort);
                const chunks=[];
                for await (const chunk of torrent.files[0].createReadStream({start:100,end:20000})) chunks.push(chunk);
                if (!Buffer.concat(chunks).equals(payload.subarray(100,20001))) throw new Error('Verified torrent range differs from fixture');
                resolve();
              } catch(error) { reject(error); }
            });
          });
        }),
        new Promise((_,reject) => {timer=setTimeout(()=>reject(new Error('Local torrent transfer timed out')),15000)})
      ]);
      console.log('TCP_RANGE_OK');
    } finally {
      clearTimeout(timer);
      await Promise.all([seeder,reader].map(client=>new Promise(resolve=>client.destroy(resolve))));
      if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('hobbyfiles-tcp-test-'))fs.rmSync(dir,{recursive:true,force:true});
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: path.join(__dirname, "../.."), encoding: "utf8", timeout: 25000 });
  expect({ status: result.status, error: result.stderr }).toEqual({ status: 0, error: "" });
  expect(result.stdout).toContain("TCP_RANGE_OK");
}, 30000);
