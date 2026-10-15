local rkey = KEYS[1]
local key = ARGV[1]
local expected = ARGV[2]
local value = ARGV[3]
if redis.call("HGET", rkey, key) ~= expected then
  return 0
end
cjson.decode(key)
cjson.decode(value)
redis.call("HSET", rkey, key, value)
-- Deliver to the originating worker too: pub/sub preserves update order.
redis.call("PUBLISH", rkey, '[{"pid":"atomic","t":"s","k":' .. key .. ',"v":' .. value .. '}]')
return 1
