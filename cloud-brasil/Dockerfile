FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Chave pública do servidor do GitHub, conferida pela impressão digital oficial publicada pelo GitHub.
RUN mkdir -p /etc/ssh && ssh-keyscan -t ed25519 github.com > /etc/ssh/github_known_hosts 2>/dev/null \
 && ssh-keygen -lf /etc/ssh/github_known_hosts | grep -q 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU'
COPY run.sh /app/run.sh
RUN chmod +x /app/run.sh
CMD ["/app/run.sh"]
