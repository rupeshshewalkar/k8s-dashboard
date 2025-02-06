# Build stage
FROM golang:1.21-alpine AS builder

# Set build arguments for security
ARG CGO_ENABLED=0
ARG GOOS=linux

# Install build dependencies
RUN apk add --no-cache git ca-certificates

# Configure working directory
WORKDIR /app

# Download dependencies first for better caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build binary with security flags
RUN go build \
    -mod=readonly \
    -ldflags="-w -s -extldflags '-static'" \
    -trimpath \
    -o main .

# Final stage
FROM alpine:3.19

# Add non-root user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Install runtime dependencies
RUN apk add --no-cache ca-certificates tzdata

# Configure working directory and permissions
WORKDIR /app
RUN chown appuser:appgroup /app

# Copy pre-built binary from builder
COPY --from=builder --chown=appuser:appgroup /app/main /app/main

# Drop privileges
USER appuser

# Security-related environment variables
ENV GODEBUG=netdns=go \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

# Entrypoint configuration
CMD ["/app/main"]