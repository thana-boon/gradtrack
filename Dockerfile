# ไม่ตั้ง `# syntax=docker/dockerfile:1` โดยตั้งใจ — บรรทัดนั้นสั่งให้ BuildKit ไปโหลด
# image ตัวแปล Dockerfile จาก Docker Hub ก่อนเริ่ม build ทุกครั้ง เน็ตโรงเรียนสะดุด
# เมื่อไหร่ deploy ก็ล้มทันทีด้วย TLS handshake timeout ทั้งที่ base image มีในเครื่องแล้ว
# ไฟล์นี้ใช้แต่ไวยากรณ์ที่ frontend ในตัวของ BuildKit รองรับอยู่แล้ว (multi-stage, ARG,
# COPY --from) ไม่มี RUN --mount / heredoc / COPY --link จึงไม่ต้องพึ่งตัวนอก
# ⚠️ ถ้าวันหนึ่งต้องใช้ฟีเจอร์ใหม่ ๆ ค่อยใส่กลับ แล้วต้อง pre-pull docker/dockerfile ไว้ด้วย

# ===== base =====
# ตรึงด้วย digest ไม่ใช่แค่ tag — tag ทำให้ BuildKit ต้องถาม registry ว่า "20-alpine
# ตอนนี้ชี้ไปที่ image ไหน" ทุกครั้งที่ metadata cache หมดอายุ เน็ตโรงเรียนสะดุดตอนนั้น
# พอดี deploy ก็ล้มด้วย TLS handshake timeout ทั้งที่ image อยู่ในเครื่องครบแล้ว
# ใส่ digest แล้ว BuildKit ข้ามขั้นถาม registry ไปเลย หยิบจาก content store ตรง ๆ
#
# อัปเดต digest เมื่ออยากได้ security update ของ base image:
#   docker pull node:20-alpine
#   docker image inspect node:20-alpine --format '{{index .RepoDigests 0}}'
# แล้วเอาค่าที่ได้มาแทนบรรทัดล่างนี้ (ต้องทำตอนเน็ตนิ่ง ๆ)
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS base
WORKDIR /app
ENV TZ=Asia/Bangkok

# ===== build client =====
# base path ถูก bake ลงใน asset URL ทุกตัวตอน `vite build` → ต้องรู้ค่าตั้งแต่ตอน build
# ไม่ใช่ตอน runtime  (compose ส่ง BASE_PATH=/grad มาให้ ดู docker-compose.yml)
FROM base AS client
ARG BASE_PATH=
ENV BASE_PATH=$BASE_PATH
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ===== server deps (production only) =====
FROM base AS server-deps
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ===== runtime =====
FROM base AS runner
ENV NODE_ENV=production
# ARG เป็นของแต่ละ stage — ต้องประกาศใหม่ที่นี่
# runtime ต้องได้ BASE_PATH ค่าเดียวกับตอน build ไม่งั้น express mount คนละ prefix
# กับที่ asset ถูก bake ไว้ → หน้าขึ้นแต่ JS/CSS 404 ทั้งหมด
ARG BASE_PATH=
ENV BASE_PATH=$BASE_PATH
ENV PORT=3003

WORKDIR /app/server
COPY --from=server-deps /app/node_modules ./node_modules
COPY server/ ./
# client ที่ build แล้ว — express เสิร์ฟจาก ../client/dist (ดู server/index.js)
COPY --from=client /app/dist /app/client/dist

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# ไม่รันเป็น root — user "node" มากับ base image อยู่แล้ว
# uploads/ logs/ backups/ ต้องเขียนได้ และต้องมีอยู่ใน image ก่อน mount volume
# (named volume ที่ mount ครั้งแรกจะ copy ownership จากโฟลเดอร์ใน image)
RUN mkdir -p /app/server/uploads /app/server/logs /app/server/backups \
 && chown -R node:node /app/server/uploads /app/server/logs /app/server/backups
USER node

EXPOSE 3003

# ไม่มี HEALTHCHECK ใน image — กำหนดใน compose แทน เพราะ path ขึ้นกับ BASE_PATH
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "index.js"]
