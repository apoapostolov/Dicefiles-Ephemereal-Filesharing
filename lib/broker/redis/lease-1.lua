local current = redis.call('GET', KEYS[1])
if current ~= ARGV[1] then return 0 end
if ARGV[2] == 'release' then return redis.call('DEL', KEYS[1]) end
return redis.call('PEXPIRE', KEYS[1], ARGV[2])
