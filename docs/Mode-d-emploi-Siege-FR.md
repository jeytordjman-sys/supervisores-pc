# Supervisores P&C — mode d'emploi siège (1 page)

**Où ?** L'app « Supervisores P&C » (web, sur ordinateur et téléphone). Aperçu de travail : https://floot.com/mcp-preview/8c155ad2-8f7d-4ac0-88fa-9c781d5a1f14 (ouvrir le projet dans Floot et cliquer **Publish** pour obtenir l'adresse définitive `….floot.app`).
**Connexion :** email + mot de passe. Votre compte sède : jeytordjman@gmail.com → « Forgot password? » la première fois (le code arrive sur votre email). Comptes de démo : voir `static/__dev/notes/demo-accounts.md` dans le projet.

## 1. Ce que vous regardez chaque semaine (5 minutes) — onglet **Sede → Painel**
- **6 compteurs** : lojas ativas · visitas em atraso · ações em atraso · ruturas refs chave · envios com diferença · visitas 30 dias. Tout à 0 = rien à faire.
- **Por supervisor** : nb de magasins, **% cadências ✓** (taux de respect des cadences), visites en retard, visites 30 j, actions ouvertes / en retard, ruptures, écarts d'envoi.
- **Lojas em exceção** : seulement les magasins en retard de visite, avec actions en retard, ruptures ou écarts. Clic → fiche complète.
- **Pontos não conformes · 90 dias** : ce qu'il faut travailler avec les équipes. **Últimos imports** : contrôle que l'import Sage tourne bien chaque nuit.

## 2. Régler sans toucher au code — onglet **Sede → Configuração**
| Je veux… | Où |
|---|---|
| Changer la cadence d'un magasin (A = 2 sem., B = mois, C = trimestre) | Lojas e cadências → Editar → *Cadência* |
| Cadence temporaire (magasin en difficulté, ouverture) | même fiche : *Cadência temporária* + *Temporária até* (revient à la normale après la date) |
| Changer la durée d'une cadence (ex. A = 10 jours), le seuil « stock dormant » (90 j), « sans envoi » (14 j), « cette semaine » (7 j) | Parâmetros |
| Ajouter / modifier / désactiver un point de checklist (texte de l'action créée, délai, responsable) | Checklist da visita → + Ponto / Editar |
| Ajouter un magasin | Lojas e cadências → + Loja : nom, **Código Sage** (= colonne Site des CSV), responsable, **email du responsable** (reçoit les comptes rendus), superviseur, cadence |
| Ajouter un superviseur | Supervisores e acessos → + Supervisor : nom, email, mot de passe initial (à lui communiquer) |
| Donner accès siège à quelqu'un | même écran, perfil « Sede » |

## 3. Ce qui se fait tout seul
- **À chaque visite** : compte rendu (checklist, photos, note, commentaire) envoyé par email au responsable du magasin (copie superviseur) + 1 action par point non conforme, avec délai et responsable pris dans la checklist.
- **Lundi 8h00** : chaque superviseur reçoit « Lojas a visitar esta semana » (retard + 7 prochains jours, actions ouvertes, alertes).
- **Jours ouvrés 8h30** : rappel des actions dépassées au responsable du magasin (copie superviseur), une fois par jour.
Deux prérequis Floot : (1) onglet **Email** → ajouter votre domaine (ex. `mail.perfumesecompanhia.pt`) et poser les enregistrements DNS, puis mettre le remetente dans Parâmetros — sans cela, les emails n'arrivent qu'à vous ; (2) les envois planifiés (lundi, 8h30) ne tournent que sur l'**app publiée** avec un **plan Floot payant**.

## 4. Import Sage X3 (dossier `import-sage`)
Manuel : **Sede → Import Sage X3** → choisir le CSV (stock, expéditions, KPI). Automatique chaque nuit : sur un poste qui voit le dossier partagé, installer Python 3, copier `config.example.ini` → `config.ini` (adresse de l'app publiée + **chave do import** affichée dans Parâmetros + chemin du dossier), tester `py -I import_sage.py` (journal `import_sage.log`, qui signale les sites Sage sans magasin), puis `installer_tache_nocturne.ps1` (tâche Windows 3h30). Formats : voir `exemples/`.

## 5. Pilote (1 mois, 1–2 superviseurs)
Semaine 1 : Publier l'app, supprimer les données *(exemplo)*, créer magasins et superviseurs réels, vérifier le domaine email, lancer un import à la main. Semaines 2–4 : les superviseurs n'utilisent **que** l'app sur téléphone (ajouter à l'écran d'accueil) ; vous ne regardez **que** le Painel. Fin de pilote : ajuster checklist, délais, cadences, puis inviter les autres superviseurs.

**Limites connues** : la position GPS est demandée au téléphone au moment de la visite (le superviseur peut refuser ; les photos prises avec l'appareil gardent la leur). Un point de checklist désactivé disparaît des nouvelles visites mais reste dans l'historique.
