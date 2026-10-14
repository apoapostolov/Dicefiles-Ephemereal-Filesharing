local value = redis.call("HGET", KEYS[1], ARGV[1])
if not value or string.sub(value, 1, string.len(ARGV[2]) + 1) ~= ARGV[2] .. "|" then return 0 end
local expires = tonumber(redis.call("ZSCORE", KEYS[2], ARGV[1]))
if not expires or expires <= tonumber(ARGV[3]) then return 0 end
redis.call("ZADD", KEYS[2], tonumber(ARGV[4]), ARGV[1])
return 1
