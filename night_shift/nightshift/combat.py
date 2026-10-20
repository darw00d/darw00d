"""Hitting things, being hit, and the paperwork that follows."""

from . import flavour


def player_melee(game, enemy):
    dmg = game.rng.randint(*game.player.melee_damage)
    game.log.add(game.rng.choice(flavour.PLAYER_HIT).format(name=enemy.name) + f" ({dmg})")
    if not damage_enemy(game, enemy, dmg):
        enemy.on_hit_by_player(game)


def damage_enemy(game, enemy, amount):
    """Apply damage; returns True if the enemy died."""
    taken = enemy.take_damage(game, amount)
    enemy.awake = True
    if taken > 0 and enemy.hp <= 0:
        kill_enemy(game, enemy)
        return True
    return False


def kill_enemy(game, enemy):
    if enemy not in game.enemies:
        return
    game.enemies.remove(enemy)
    p = game.player
    p.kills += 1
    reward = game.rng.randint(*enemy.reward)
    p.tickets += reward
    p.sanity = min(p.max_sanity, p.sanity + 3)    # closing a ticket is good for the soul
    line = game.rng.choice(enemy.death_lines).format(name=enemy.name)
    game.log.add(f"{line} +{reward} ticket closure{'' if reward == 1 else 's'}.", "good")
    enemy.on_death(game)


def enemy_attack(game, enemy, line=None):
    dmg = game.rng.randint(*enemy.damage)
    kind = enemy.attack_kind
    stat = "Sanity" if kind == "sanity" else "HP"
    text = line or f"The {enemy.name} hits you."
    game.log.add(f"{text} (-{dmg} {stat})", "bad")
    hurt_player(game, dmg, enemy.name, kind)


def hurt_player(game, amount, source, kind="hp"):
    p = game.player
    if amount <= 0 or not p.alive or game.state != "playing":
        return
    if kind == "sanity":
        p.sanity = max(0, p.sanity - amount)
        if p.sanity == 0:
            game.player_died(source, "sanity")
    else:
        p.hp = max(0, p.hp - amount)
        if p.hp == 0:
            game.player_died(source, "hp")
