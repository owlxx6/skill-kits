Tu travailles sur owlxx6/skill-kits avec un autre agent. Lis docs/LAUNCH-PLAN.md avant toute modification. Le public comprend développeurs et utilisateurs moins techniques. Chaque agent utilise sa propre branche et son propre dossier de travail. Ne modifie pas le dossier de travail de l'autre agent. Ne réinitialise pas les modifications existantes.

La direction choisie est Switchyard + Career Desk, blanc/noir/rouge et bouton de thème icon-only. Les références approuvées comme direction sont docs/design-previews/signal-map.html et career-desk.html. Leur intégration Astro devra encore être montrée et approuvée.

Main est la branche de production prévue. Travaille sur la branche indiquée, avec commits ciblés et PR relue. Aucun merge dans main sans validation du propriétaire. Pour le design, montre le résultat desktop/mobile avant de pousser l'implémentation. Les trois branches initiales ont été vérifiées sur GitHub au commit 38b3c4f. Récupère aussi le dernier plan depuis planning/launch-parallel avant de commencer.

Signale les modifications de contrats de données à l'autre agent avant qu'il développe dessus. Ne touche pas simultanément à package.json, package-lock.json, catalog.json ou .github sans répartition explicite. Utilise les commandes du README, npm.cmd dans PowerShell si nécessaire. Le pipeline complet peut consommer une API payante; ce prompt n'autorise pas de nouvelles dépenses.

Le propriétaire a confirmé B pour les licences. Il reste à décider catalogue public d'abord ou comptes dès le premier lancement. Clarifie ces décisions quand elles bloquent ta tâche. Ne transforme pas une préférence d'implémentation en demande d'approbation.

TA BRANCHE: claude/license-resolution
TA PREMIÈRE MISSION: implémenter l’option B confirmée, après avoir défini le contrat précis de résolution des licences et coordonné les champs de données avec Codex.
PÉRIMÈTRE: pipeline/filter.ts, extract.ts, rank.ts, review.ts si lié, pipeline/lib/schemas.ts et fichiers de support/tests nécessaires. Tu possèdes les schémas pendant cette tâche.
Le filtre actuel élimine les dépôts sans licence avant de lire les skills. Il faut permettre leur inspection puis décider l'éligibilité par skill avec preuve. Ne réintègre pas tous les skills officiels par défaut.
Gère les anciens enregistrements, les caches, les licences mixtes, les preuves ambiguës et l'invalidation des fichiers de licence. Conserve un affichage honnête de la licence. Propose les champs requis à Codex avant de casser l'ancien format.
Relève aussi les écarts du sprint curation: cache de 40 000 skills absent du Lenovo, neuf revues CV provisoires à identifier, lecture actuellement coupée à 24 000 caractères. Ce sont des suivis, pas une autorisation de réévaluer tous les skills maintenant.
LIVRABLES: explication des règles, tests pertinents, typecheck et tests existants, impact catalogue documenté. En parallèle Codex intègre le design dans site/. Relis sa PR; il relira la tienne.

CRITÈRE CONFIRMÉ: priorité à la fiabilité et à la valeur démontrée pour une tâche. Faible usage, peu de stars ou de forks ne disqualifient pas un skill. Lire la section Selection policy du plan; conserver les preuves de licence, de revue et de test, ainsi que la validation finale du propriétaire. Documenter la révision du seuil minStars et du classement pour un suivi coordonné.
