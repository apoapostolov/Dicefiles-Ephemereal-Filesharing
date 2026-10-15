local rkey = KEYS[1]
local pid = ARGV[1]
local op = ARGV[2]
local key
local val

if op == "set" then
  key = ARGV[3]
  val = ARGV[4]
  cjson.decode(key)
  cjson.decode(val)
  redis.call("HSET", rkey, key, val)
  -- Redis cjson turns empty JSON arrays into objects on re-encode. Embed the
  -- validated original JSON so live workers receive the same types as storage.
  redis.call("PUBLISH", rkey, '[{"pid":' .. cjson.encode(pid) .. ',"t":"s","k":' .. key .. ',"v":' .. val .. '}]')
elseif op == "delete" then
  key = ARGV[3]
  cjson.decode(key)
  redis.call("HDEL", rkey, key)
  redis.call("PUBLISH", rkey, '[{"pid":' .. cjson.encode(pid) .. ',"t":"d","k":' .. key .. '}]')
elseif op == "clear" then
  redis.call("DEL", rkey)
  redis.call("PUBLISH", rkey, cjson.encode({{pid=pid, t="c"}}))
else
  return redis.error_reply("Invalid dmap operation")
end
