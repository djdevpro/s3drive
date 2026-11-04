/**
 * Transferts de l'appli : file d'envoi persistée dans Dexie
 * autour de `@ud/sdk/upload`, dossiers, reprise au rechargement, téléchargements.
 *
 * API pour l'explorateur :
 *
 * ```tsx
 * const uploads = useUploadQueue('drive');                 // file unique de la connexion pour l'onglet
 * const target = { bucket: 'home', prefix: 'Docs/' };      // espace + dossier courant ('' = racine)
 *
 * uploads.addFiles(input.files, target);                   // <input type="file" multiple>
 * await uploads.addFolderInput(input.files, target);       // <input type="file" webkitdirectory>
 * onDrop={(e) => { e.preventDefault(); void uploads.addDataTransfer(e.dataTransfer, target); }}
 *                                                          // glisser-déposer : appel synchrone dans `drop`
 * uploads.items / uploads.totals                           // état (≤ 4 rendus/s) : UploadItemView[], totaux
 * uploads.pause(id) · resume(id) · retry(id) · cancel(id)
 * uploads.resolveConflict(id, 'overwrite' | 'rename' | 'skip', all?)
 * uploads.pauseAll() · resumeAll() · retryAll() · cancelAll() · clearFinished()
 * uploads.reselect(files)                                  // fichiers à resélectionner après rechargement
 *
 * <UploadPanel {...useUploadPanel('drive', { folderLabel, onShowInFolder, onReselect })} />
 *
 * await downloadFile('drive', 'home', 'Docs/rapport.pdf'); // URL présignée 1 h, ouverte par un lien caché
 * downloadHref('drive', 'home', 'Docs/rapport.pdf')        // lien direct (?redirect=1)
 * ```
 *
 * Conflits : par défaut `ask` (ligne en état `conflict`, boutons du panneau) ; `addFiles(files, target,
 * { conflict: 'rename' })` pour « Conserver les deux » d'office. Quota : un refus reste en `error` avec
 * `error.code = 'quota_exceeded'` et `error.details.remaining` (octets), traduit par le panneau.
 * Après un envoi réussi (`state: 'done'`), l'hôte invalide la liste du dossier cible (08).
 */
export { UploadQueue, getUploadQueue, setUploadQueue, type AddOptions, type FolderResult, type ReselectResult, type UploadQueueOptions, type UploadTarget } from './queue';
export { useUploadPanel, useUploadQueue, toPanelItems, type UseUploadPanelOptions, type UseUploadQueue } from './hooks';
export { downloadFile, downloadHref, type DownloadOptions } from './download';
export { DexieUploadStore, connectionDatabase, hasIndexedDb, type UploadsDatabase } from './db';
export { entriesOfDataTransfer, fromEntries, fromFileList, type Enumeration, type SourceFile } from './sources';
