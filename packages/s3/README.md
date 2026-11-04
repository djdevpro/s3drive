# @ud/s3

Server-side S3 engine for Node 24: client factory with provider presets, listing, presigned GET and PUT
with a signed `Content-Length`, multipart uploads, copy (multipart above 5 GB), batch delete, prefix size,
error mapping to stable codes, and an SSRF guard with pinned DNS resolution. Credentials are passed per
client and never logged.

```ts
import { createS3 } from '@ud/s3';

const s3 = createS3({ endpoint, region, addressing: 'virtual', credentials });
const page = await s3.listObjects({ bucket, prefix: 'docs/' });
```
