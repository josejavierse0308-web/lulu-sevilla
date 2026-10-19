-- ============================================================================
-- 1000 · Almacenamiento privado de documentos del expediente
-- Bucket privado: los archivos solo se descargan con URLs firmadas de corta
-- duración generadas para la cuenta administradora.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expedientes', 'expedientes', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy expedientes_select on storage.objects for select to authenticated
  using (bucket_id = 'expedientes' and (select private.is_admin()));
create policy expedientes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'expedientes' and (select private.is_admin()) and name ~ '^patients/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png)$');
create policy expedientes_update on storage.objects for update to authenticated
  using (bucket_id = 'expedientes' and (select private.is_admin()))
  with check (bucket_id = 'expedientes' and (select private.is_admin()));
create policy expedientes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'expedientes' and (select private.is_admin()));
