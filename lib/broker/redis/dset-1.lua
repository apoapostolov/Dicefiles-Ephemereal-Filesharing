local key = KEYS[1]
local pid = ARGV[1]
local op = ARGV[2]
local item

if op == "add" then
  item = ARGV[3]
  cjson.decode(item)
  redis.call("SADD", key, item)
  redis.call("PUBLISH", key, '[{"pid":' .. cjson.encode(pid) .. ',"t":"a","v":' .. item .. '}]')
elseif op == "delete" then
  item = ARGV[3]
  cjson.decode(item)
  redis.call("SREM", key, item)
  redis.call("PUBLISH", key, '[{"pid":' .. cjson.encode(pid) .. ',"t":"d","v":' .. item .. '}]')
elseif op == "clear" then
  redis.call("DEL", key)
  redis.call("PUBLISH", key, cjson.encode({{pid=pid, t="c"}}))
else
  return redis.error_reply("Invalid dset operation")
end
