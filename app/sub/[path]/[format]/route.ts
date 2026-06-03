import { NextRequest } from "next/server";
import { GET as mainGET } from "../route";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string; format: string }> }
) {
  const { path, format } = await params;

  // Clone URL and append format so the main route can handle it transparently
  const url = new URL(req.url);
  url.searchParams.set("format", format);

  const modifiedReq = new NextRequest(url.toString(), {
    headers: req.headers,
    method: req.method,
    body: req.body,
    signal: req.signal,
  });

  const wrappedParams = Promise.resolve({ path });
  return mainGET(modifiedReq, { params: wrappedParams });
}
