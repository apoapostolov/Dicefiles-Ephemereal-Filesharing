local reservation = redis.call("HGET", KEYS[1], ARGV[1])
if not reservation then
  redis.call("ZREM", KEYS[2], ARGV[1])
  return 0
end

local separator = string.find(reservation, "|", 1, true)
local volumeId = string.sub(reservation, 1, separator - 1)
local bytes = tonumber(string.sub(reservation, separator + 1)) or 0
if volumeId ~= ARGV[2] then
  return -1
end

redis.call("HDEL", KEYS[1], ARGV[1])
redis.call("ZREM", KEYS[2], ARGV[1])
local remaining = redis.call("HINCRBY", KEYS[3], volumeId, -bytes)
if remaining < 0 then
  redis.call("HSET", KEYS[3], volumeId, 0)
end
return bytes
