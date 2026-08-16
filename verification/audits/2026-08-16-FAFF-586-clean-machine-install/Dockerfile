# FAFF-586 clean-machine install verification.
# A genuinely clean host: ubuntu:24.04 (matches the fly runner substrate),
# Node 20, git. NO faff, no link-skills.sh symlinks, no ~/.claude/skills.
# The only faff that ever appears is what the two documented README lines install.
#
# Reproduce:
#   docker build -t faff-586-clean .
#   docker run -d --name faff586 faff-586-clean
#   docker exec faff586 claude plugin marketplace add shftwst/faff
#   docker exec faff586 claude plugin install faff@faff
#   docker exec faff586 claude plugin details faff
# To read the actual command spellings, stage a Claude Code credential into
# /home/tester/.claude/.credentials.json and run a headless probe (see the audit).
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Claude Code, the harness the README install lines run inside.
RUN npm install -g @anthropic-ai/claude-code

# Non-root user, no pre-seeded ~/.claude — a stranger's fresh machine.
RUN useradd -m -u 1001 -s /bin/bash tester
USER tester
WORKDIR /home/tester
CMD ["sleep", "infinity"]
