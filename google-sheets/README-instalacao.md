# Installation Google Sheets + Apps Script — Supervisores P&C

100 % gratuit, sans carte bancaire. ~15 minutes, tout dans le navigateur.
Les données vivent dans **une feuille Google à toi** ; les e-mails partent de **ta boîte Gmail**.

## 1. Créer la feuille

1. Ouvre https://sheets.new (connecté au compte Google qui enverra les e-mails).
2. Renomme-la `Supervisores P&C – dados`.

## 2. Coller le script

1. Dans la feuille : menu **Extensions → Apps Script**. Un éditeur s'ouvre avec un fichier `Code.gs`.
2. Ouvre ce lien, sélectionne tout (Ctrl+A), copie (Ctrl+C) :
   https://raw.githubusercontent.com/jeytordjman-sys/supervisores-pc/main/google-sheets/Code.gs
3. Dans l'éditeur Apps Script : efface le contenu de `Code.gs`, colle (Ctrl+V), puis **💾 Enregistrer** (Ctrl+S).

## 3. Lancer l'installation (une seule fois)

1. En haut de l'éditeur, dans la liste déroulante des fonctions, choisis **`setup`** → clique **▶ Exécuter**.
2. Google demande l'autorisation : **Examiner les autorisations** → choisis ton compte → écran « Google n'a pas validé cette application » → **Paramètres avancés** → **Accéder à … (non sécurisé)** → **Autoriser**.
   C'est normal : c'est *ton* script, sur *ton* compte ; Google affiche cet écran pour tout script personnel.
3. Attends « Exécution terminée ». Retourne dans la feuille : les onglets `users`, `stores`, `visits`, `log`, `audit`… sont créés.
4. (Optionnel) Pour démarrer avec 8 lojas d'exemple : exécute de la même façon la fonction **`carregarLojasExemplo`**.

`setup` programme aussi : l'agenda du lundi 07:00, le rappel quotidien des actions en retard 07:30 (jours ouvrés), et crée le dossier Drive « Supervisores P&C – fotos das visitas ».

## 4. Publier l'App Web

1. En haut à droite : **Déployer → Nouveau déploiement**.
2. Roue dentée ⚙ à côté de « Sélectionner le type » → **Application Web**.
3. *Exécuter en tant que* : **Moi** · *Qui a accès* : **Tout le monde**.
4. **Déployer** → copie l'**URL de l'application Web** (elle se termine par `/exec`).

« Tout le monde » veut dire que l'adresse répond à l'app sans compte Google ; **rien n'est lisible sans compte + mot de passe de l'app**, et chaque nouveau compte doit être activé par la Sede.

## 5. Brancher l'app

Envoie l'URL `/exec` à Claude (ou mets-la toi-même dans `config.js` à la racine du dépôt, copie de `config.example.js`, puis commit + push) :

```js
window.GAS_CONFIG = { url: "https://script.google.com/macros/s/XXXXXXXX/exec" };
```

GitHub Pages se met à jour en ~1 minute : https://jeytordjman-sys.github.io/supervisores-pc/

## 6. Première utilisation

1. Ouvre l'app → **+ Criar a minha conta**. **Le premier compte créé est « Sede » et actif.**
2. Les superviseurs créent leur compte de la même façon : ils voient « aguarda ativação » et tu reçois un e-mail.
3. **Bastidor → Contas** : coche *Ativa*. **Bastidor → Configuração** : attribue les lojas, remplis le téléphone (WhatsApp) et l'e-mail du responsable de chaque loja, et l'e-mail de la Sede (copie des agendas).
4. Test : enregistre une visite → le responsable reçoit le relatório par e-mail (copie au superviseur) ; dans la fiche de la loja, « ✉️ E-mail automático: enviado ».

## Où voir « chaque changement »

| Onglet de la feuille | Contenu |
|---|---|
| `log` | Tout ce que chaque compte a fait : qui, quand, quoi (c'est aussi Bastidor → Histórico) |
| `audit` | Avant / après de chaque ligne modifiée (comptes, config, lojas, visites, actions, agenda) |
| `outbox` | Chaque e-mail envoyé, avec son statut (`sent`, `error`, `skipped`) |
| `visits`, `actions`, `planned`, `stores`… | Les données elles-mêmes |

Tu peux lire, filtrer, exporter ces onglets librement. **Évite de modifier à la main** les onglets `users` et `sessions` (mots de passe hachés, sessions). Google Sheets garde aussi son propre historique : *Fichier → Historique des versions*.

## Mettre à jour le script plus tard

Recolle le nouveau `Code.gs`, enregistre, puis **Déployer → Gérer les déploiements → ✏️ → Version : Nouvelle version → Déployer**. L'URL `/exec` ne change pas. (Relancer `setup` est sans danger : il ajoute seulement ce qui manque.)

## Import nocturne Sage X3 (optionnel)

Sur le PC qui voit le dossier des CSV : dossier `import-sage/`, copier `config.example.ini` → `config.ini`, section `[gsheets]` :
- `url` = l'URL `/exec`
- `import_key` = Apps Script → ⚙ **Paramètres du projet** → *Propriétés du script* → `IMPORT_KEY`

Test : `py import_gsheets.py`. Planification : `installer_tache_nocturne.ps1` (remplacer `import_sage.py` par `import_gsheets.py`).

## Limites (compte Google gratuit)

- **100 destinataires d'e-mail par jour** (1 500 avec Google Workspace). Un relatório = 2 destinataires (loja + copie superviseur).
- Chaque action prend 1 à 3 secondes côté serveur ; l'app n'attend pas : elle enregistre tout de suite à l'écran et envoie en arrière-plan. **Sans réseau, elle garde les changements dans le téléphone** et les envoie au retour de la connexion (« ⚠ sem rede · N por enviar » en haut).
- Les autres utilisateurs voient les changements en moins d'une minute (ou bouton ↻).
- Photos : enregistrées dans ton Drive, lisibles par lien (nécessaire pour les afficher dans l'app).
- Confort jusqu'à quelques dizaines de milliers de lignes ; au-delà, passer à une vraie base (le dossier `supabase/` est prêt).

## Tester sans toucher à la vraie feuille (développeurs)

`node google-sheets/dev-mock-server.js` lance `Code.gs` en local avec de fausses feuilles en mémoire (http://127.0.0.1:8767/exec) ; mettre cette URL dans `config.js` et servir le dépôt en local.
