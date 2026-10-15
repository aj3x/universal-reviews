FROM rust:1-slim AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
COPY --from=build /src/target/release/rating-read /usr/local/bin/rating-read
USER 1000
ENV DATABASE_PATH=/data/rating.db PORT=8081
EXPOSE 8081
CMD ["rating-read"]
