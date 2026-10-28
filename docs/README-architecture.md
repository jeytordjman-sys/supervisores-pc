# App « Supervisores P&C » — architecture et livrables

## Architecture retenue : app web dédiée, mobile-first, hébergée sur Floot
1. **Une vraie app, pas un tableur habillé** : écrans conçus pour le téléphone (barre d'onglets, cases à toucher, photos depuis l'appareil, GPS), vue siège sur ordinateur, en portugais.
2. **Zéro code au quotidien** : magasins, cadences (y compris temporaires), checklist (texte d'action, délai, responsable), seuils d'alerte, superviseurs et accès se règlent dans l'écran *Sede → Configuração*.
3. **Tout est hébergé au même endroit** (Floot) : base Postgres, API, envoi d'emails, stockage des photos, tâches planifiées, publication en un clic, apps iOS/Android possibles plus tard sans redévelopper.
4. **Contrôle par exception natif** : le serveur calcule retards, alertes et écarts ; le Painel n'affiche que ce qui sort du cadre.
5. **Import Sage X3 robuste** : import manuel (glisser le CSV) et import nocturne par script, même format, même contrôle des sites inconnus.

## Ce qui est construit (projet Floot « Supervisores P&C », id `8c155ad2-8f7d-4ac0-88fa-9c781d5a1f14`)
**Données** : lojas · checklist_items · visits + visit_results + visit_photos · actions · stock · shipments · monthly_kpis · settings · import_logs · utilisateurs (rôle *admin* = siège, *user* = superviseur).
**Calculs** : cadence effective (temporaire si en cours) → prochaine visite = dernière + cadence (A 14 / B 30 / C 91 j, modifiables) → état 🔴🟠🟢 ; alertes = ruptures refs clés, stock dormant > 90 j, envois avec écart, actions en retard, pas d'envoi > 14 j.
**Écrans superviseur (4 + login)** : Lojas · Ficha de loja (hub) · Nova visita · Ações. **Écran siège** : Painel (compteurs, par superviseur avec % cadences, magasins en exception, non-conformités 90 j, derniers imports) · Configuração · Import Sage X3.
**Automatismes** : compte rendu + photos par email à chaque visite (cc superviseur) ; 1 action par point non conforme ; lundi 8h00 agenda de la semaine par superviseur ; jours ouvrés 8h30 rappel des actions dépassées au responsable du magasin.
**Import Sage X3** : API `/_api/import/rows` (session siège ou clé d'import) ; dossier `import-sage/` (`import_sage.py`, `config.example.ini`, `installer_tache_nocturne.ps1`, `exemples/`).
**Documentation dans le projet** : `static/__dev/notes/architecture.md`, `static/__dev/notes/demo-accounts.md`.

## À faire par vous avant le pilote (≈ 1 h)
- [ ] Ouvrir le projet dans Floot et cliquer **Publish** (adresse `….floot.app`) — c'est l'adresse à donner aux superviseurs et à mettre dans `config.ini`.
- [ ] Se connecter (« Forgot password? » avec jeytordjman@gmail.com), puis *Sede → Configuração* : supprimer/désactiver les données *(exemplo)*, créer magasins (Código Sage !) et superviseurs réels.
- [ ] Floot → onglet **Email** : ajouter le domaine d'envoi, poser les DNS, puis renseigner le remetente dans *Parâmetros* (sinon les emails ne partent qu'à vous).
- [ ] Plan Floot payant pour activer les envois du lundi et les rappels quotidiens (les comptes rendus de visite partent sans cela).
- [ ] Remettre `import-sage/` à l'informatique avec la clé d'import (Parâmetros).

## Limites et choix à connaître
- Les emails planifiés (lundi / rappels) ne tournent que sur l'app publiée, plan payant ; le compte rendu de visite part toujours.
- Les photos sont stockées sur Floot (URL publique non devinable) ; on peut passer en privé si la DPO le demande.
- Chiffres de ventes / trafic : la table et l'import existent (`kpis.csv`), l'affichage dans la fiche magasin aussi ; il manque seulement le fichier mensuel de l'informatique.
- Le prototype Airtable construit avant reste disponible comme base de repli, mais n'est plus maintenu.
