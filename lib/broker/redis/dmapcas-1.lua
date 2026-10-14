local rkey = KEYS[1]
local key = ARGV[1]
local expected = ARGV[2]
local value = ARGV[3]
if redis.call("HGET", rkey, key) ~= expected then
  return 0
end
redis.call("HSET", rkey, key, value)
-- Deliver to the originating worker too: pub/sub preserves update order.
redis.call("PUBLISH", rkey, cjson.encode({{pid="atomic", t="s", k=cjson.decode(key), v=cjson.decode(value)}}))
return 1
