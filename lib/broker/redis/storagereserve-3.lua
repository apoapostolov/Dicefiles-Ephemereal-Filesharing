local reservation = redis.call("HGET", KEYS[1], ARGV[1])
local oldBytes = 0
if reservation then
  local separator = string.find(reservation, "|", 1, true)
  local oldVolume = string.sub(reservation, 1, separator - 1)
  oldBytes = tonumber(string.sub(reservation, separator + 1)) or 0
  if oldVolume ~= ARGV[2] then
    return {-1, oldBytes}
  end
end

local expired = redis.call("ZRANGEBYSCORE", KEYS[2], 0, tonumber(ARGV[5]))
for _, uploadKey in ipairs(expired) do
  local value = redis.call("HGET", KEYS[1], uploadKey)
  if value then
    local separator = string.find(value, "|", 1, true)
    local volumeId = string.sub(value, 1, separator - 1)
    local bytes = tonumber(string.sub(value, separator + 1)) or 0
    if volumeId == ARGV[2] then
      redis.call("HINCRBY", KEYS[3], volumeId, -bytes)
    end
    redis.call("HDEL", KEYS[1], uploadKey)
  end
  redis.call("ZREM", KEYS[2], uploadKey)
end

local requested = tonumber(ARGV[3]) or 0
local current = tonumber(redis.call("HGET", KEYS[3], ARGV[2])) or 0
local delta = requested - oldBytes
if current + delta > tonumber(ARGV[4]) then
  return {0, current}
end

redis.call("HSET", KEYS[1], ARGV[1], ARGV[2] .. "|" .. requested)
redis.call("ZADD", KEYS[2], tonumber(ARGV[6]), ARGV[1])
if delta ~= 0 then
  redis.call("HINCRBY", KEYS[3], ARGV[2], delta)
end
return {1, current + delta}
