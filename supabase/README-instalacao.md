# Installation Supabase + Resend — Supervisores P&C

Temps total : ~30 minutes, tout se fait dans le navigateur. Aucune ligne de code à écrire.

## 1. Projet Supabase (base de données + comptes)

1. https://supabase.com → **New project** : nom `supervisores-pc`, région **West EU (Ireland)**, mot de passe de base de données quelconque (à garder, on ne s'en sert pas au quotidien).
2. **SQL Editor** → *New query* → coller tout le contenu de [`schema.sql`](schema.sql) → **Run**. Message attendu : *Success. No rows returned*.
3. (Optionnel) Même chose avec [`seed.sql`](seed.sql) : charge la checklist et 8 lojas d'exemple sans supervisor. Sinon, créez les lojas dans Bastidor → Configuração.
4. **Database → Extensions** → chercher `pg_cron` → **Enable**. Puis relancer `schema.sql` une seconde fois (c'est lui qui programme l'agenda du lundi 07:00 et le rappel quotidien 07:30 — il ne le fait que si pg_cron est actif).
5. **Authentication → Providers → Email** : laisser *Enable email provider* activé. Pour le pilote, **désactiver « Confirm email »** (les superviseurs entrent directement après avoir créé leur compte ; la Sede les active ensuite dans le Bastidor). Réactivable plus tard.
6. **Authentication → URL Configuration** : *Site URL* = `https://jeytordjman-sys.github.io/supervisores-pc/` et ajouter la même adresse dans *Redirect URLs* (nécessaire pour « Esqueci-me da password »).
7. **Project Settings → API** : copier **Project URL** et la clé **anon public**. → Les coller dans `config.js` à la racine du dépôt (copie de `config.example.js`), commit, push. GitHub Pages se met à jour en ~1 min.

> La clé **anon** est faite pour être publique : la protection vient des règles RLS de `schema.sql` (chaque superviseur ne voit que ses lojas, l'historique est écrit par le serveur). La clé **service_role** ne va **jamais** dans le dépôt : uniquement dans `import-sage/config.ini` sur le PC qui fait l'import nocturne.

## 2. Première connexion

1. Ouvrir https://jeytordjman-sys.github.io/supervisores-pc/ → **+ Criar a minha conta**. **La première compte créée est automatiquement « Sede » et active.** Toutes les suivantes sont « Supervisor » et **inactives** jusqu'à activation.
2. Bastidor → **Contas** : activer chaque superviseur, choisir le profil ; **Configuração** : attribuer les lojas, remplir téléphone (WhatsApp) et e-mail du responsable de chaque loja, et l'e-mail de la Sede (cc des agendas).

## 3. Envoi des e-mails (Resend + Edge Function)

1. https://resend.com → compte gratuit (3 000 e-mails/mois). **API Keys → Create** (permission *Sending*). Copier la clé.
   - Sans domaine vérifié, Resend n'envoie **qu'à l'adresse du compte Resend** (parfait pour tester).
   - Pour envoyer aux responsables : **Domains → Add domain** `app.perfumesecompanhia.pt` (ou autre sous-domaine) → l'informatique ajoute les 3 enregistrements DNS indiqués → *Verify*.
2. Dans Supabase : **Edge Functions → Deploy a new function** → *Via Editor* → nom `send-report` → coller [`functions/send-report/index.ts`](functions/send-report/index.ts) → **Deploy**.
3. **Edge Functions → Secrets** (ou *Project Settings → Edge Functions*) — ajouter :
   | Nom | Valeur |
   |---|---|
   | `RESEND_API_KEY` | la clé Resend |
   | `MAIL_FROM` | `Supervisores P&C <onboarding@resend.dev>` (test) ou `Supervisores P&C <supervisores@app.perfumesecompanhia.pt>` (domaine vérifié) |
   | `WEBHOOK_SECRET` | une phrase au hasard, ex. `pc-2026-visitas-x7` |
4. **Database → Webhooks → Create a new hook** :
   - Name `outbox-send`, Table `outbox`, Events **Insert** uniquement
   - Type **Supabase Edge Functions** → `send-report`
   - HTTP Headers : ajouter `x-webhook-secret` = la même phrase que `WEBHOOK_SECRET`
   - *Confirm*.

À partir de là : chaque visite enregistrée → relatório par e-mail au responsable de la loja (cc le superviseur) ; chaque lundi 07:00 → agenda de la semaine à chaque superviseur (cc Sede) ; chaque jour ouvré 07:30 → rappel des actions en retard. Le statut de chaque envoi est visible dans **Bastidor → Mensagens** (⏳ a enviar / ✉️ enviado / ⚠️ falhou).

Test rapide : Bastidor → Painel → **Agenda 2ª feira** sur un superviseur → Mensagens doit passer à « enviado » en quelques secondes et l'e-mail arriver.

## 4. Import nocturne Sage X3

Sur le PC/serveur qui voit le dossier des CSV :
1. Copier le dossier `import-sage/`, puis `config.example.ini` → `config.ini`, section `[supabase]` : `url`, `service_role_key` (Project Settings → API → service_role), `dossier_csv`.
2. Test manuel : `py import_supabase.py` → Bastidor → Painel → « Últimos imports Sage X3 ».
3. Planification : `installer_tache_nocturne.ps1` (remplacer `import_sage.py` par `import_supabase.py` dans la commande).

## 5. Historique et preuves

- **Bastidor → Histórico** : tout ce que chaque compte a fait (table `activity`, compte et heure tamponnées par le serveur, aucune modification/suppression possible).
- Table `audit_raw` (SQL Editor : `select * from audit_raw order by at desc`) : copie avant/après de chaque ligne modifiée dans profiles, settings, items, stores, planned, visits, actions — indépendante de l'app.
- Supabase → **Database → Backups** : sauvegardes quotidiennes automatiques (plan gratuit : 7 jours).

## Limites du plan gratuit (largement suffisant pour le pilote)

500 Mo de base, 1 Go de fichiers, 50 000 utilisateurs actifs/mois, 500 000 appels Edge Functions/mois, 2 Go de bande passante Realtime. Le projet est mis en pause après 7 jours sans activité : un simple clic *Restore* dans le dashboard le relance (à surveiller pendant les vacances).
