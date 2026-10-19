import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/auth';
import { UUID } from '@/lib/admin';

export const dynamic = 'force-dynamic';

/** Descarga: verifica la sesión, registra la descarga y redirige a una URL firmada de 60 s. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const ctx = await getAdminContext();
  if (ctx.status !== 'ok') return NextResponse.redirect(new URL('/admin/ingresar', request.url));
  if (!UUID.test(id) || !UUID.test(docId)) return new NextResponse('No encontrado', { status: 404 });

  const { data: doc } = await ctx.supabase.from('patient_documents').select('storage_path,title,mime_type').eq('id', docId).eq('patient_id', id).maybeSingle();
  if (!doc) return new NextResponse('No encontrado', { status: 404 });

  const ext = doc.mime_type === 'application/pdf' ? 'pdf' : doc.mime_type === 'image/png' ? 'png' : 'jpg';
  const safeName = `${
    String(doc.title)
      .replace(/[^\p{L}\p{N} _-]+/gu, '')
      .trim()
      .slice(0, 80) || 'documento'
  }.${ext}`;
  const { data, error } = await ctx.supabase.storage.from('expedientes').createSignedUrl(doc.storage_path, 60, { download: safeName });
  if (error || !data) return new NextResponse('No se pudo generar el enlace de descarga.', { status: 502 });

  await ctx.supabase.rpc('log_access', { p_action: 'download', p_entity: 'patient_documents', p_entity_id: docId });
  return NextResponse.redirect(data.signedUrl, { status: 303, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
