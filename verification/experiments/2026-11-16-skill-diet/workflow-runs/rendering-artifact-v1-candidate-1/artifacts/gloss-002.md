ISS-BB: Memoise the config resolver to cut cold-start
  Memoise the config resolver so repeat lookups reuse earlier results, cutting cold-start time.