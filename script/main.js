import { world, system, Player } from "@minecraft/server";

const CONFIG = {
    STRUCTURE_SCAN_RADIUS: 500,
    SCAN_INTERVAL: 60,
    THREAT_CHECK_INTERVAL: 30,
    QUEST_UPDATE_INTERVAL: 560,
    PERFORMANCE_CHECK_INTERVAL: 600,
    LOW_HEALTH_THRESHOLD: 10,
    CRITICAL_HEALTH_THRESHOLD: 6,
    LOW_AIR_THRESHOLD: 30,
    MOVEMENT_THRESHOLD: 30,
    STAGNANT_TIME: 2400,
    MAX_THREAT_DISTANCE: 12,
    CRITICAL_THREAT_DISTANCE: 4,
    HOSTILE_MOBS: [
        "minecraft:zombie", "minecraft:skeleton", "minecraft:creeper", "minecraft:spider",
        "minecraft:enderman", "minecraft:witch", "minecraft:drowned", "minecraft:husk",
        "minecraft:stray", "minecraft:phantom", "minecraft:piglin", "minecraft:zoglin",
        "minecraft:blaze", "minecraft:ghast", "minecraft:hoglin", "minecraft:wither_skeleton"
    ],
    PASSIVE_DANGER: ["minecraft:iron_golem", "minecraft:warden", "minecraft:piglin_brute"],
    BOSS_MOBS: ["minecraft:wither", "minecraft:ender_dragon"],
    DANGEROUS_BLOCKS: {
        "minecraft:lava": { priority: 10, message: "§4[CRITICAL] LAVA DETECTED!" },
        "minecraft:flowing_lava": { priority: 10, message: "§4[CRITICAL] FLOWING LAVA!" },
        "minecraft:fire": { priority: 7, message: "§c[DANGER] FIRE NEARBY!" },
        "minecraft:magma": { priority: 6, message: "§6[WARNING] Magma block detected!" },
        "minecraft:sweet_berry_bush": { priority: 2, message: "§e[CAUTION] Berry bush ahead" },
        "minecraft:cactus": { priority: 2, message: "§e[CAUTION] Cactus nearby" }
    },
    VALUABLE_ORES: {
        "minecraft:diamond_ore": { rarity: 10, message: "§b✦ DIAMONDS DETECTED! ✦" },
        "minecraft:deepslate_diamond_ore": { rarity: 10, message: "§b✦ DIAMONDS DETECTED! ✦" },
        "minecraft:ancient_debris": { rarity: 15, message: "§6✦ ANCIENT DEBRIS FOUND! ✦" },
        "minecraft:emerald_ore": { rarity: 12, message: "§a✦ EMERALD DISCOVERED! ✦" },
        "minecraft:deepslate_emerald_ore": { rarity: 12, message: "§a✦ EMERALD DISCOVERED! ✦" },
        "minecraft:gold_ore": { rarity: 5, message: "§e⚑ Gold ore detected" },
        "minecraft:deepslate_gold_ore": { rarity: 5, message: "§e⚑ Gold ore detected" },
        "minecraft:nether_gold_ore": { rarity: 3, message: "§e⚑ Nether gold ore detected" }
    }
};

const playerData = new Map();
const structuresNotified = new Map();
const threatCooldowns = new Map();
const questCooldowns = new Map();
const performanceMetrics = { updates: 0, errors: 0, avgProcessTime: 0 };

class SmartCache {
    constructor(ttl = 100) {
        this.cache = new Map();
        this.ttl = ttl;
    }

    set(key, value) {
        this.cache.set(key, { value, expires: Date.now() + this.ttl });
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        if (Date.now() > item.expires) {
            this.cache.delete(key);
            return null;
        }
        return item.value;
    }

    clear() { this.cache.clear(); }
}

const biomeCache = new SmartCache(200);
const blockCache = new SmartCache(40);

class AdvancedQuestEngine {
    static evaluatePlayerProgress(state, history) {
        const progressScore = {
            survival: this.calculateSurvivalScore(state),
            combat: this.calculateCombatScore(state, history),
            exploration: this.calculateExplorationScore(state, history),
            crafting: this.calculateCraftingScore(state)
        };
        return progressScore;
    }

    static calculateSurvivalScore(state) {
        let score = 0;
        if (state.hasFood) score += 20;
        if (state.hasBed) score += 15;
        if (state.hasShelter) score += 10;
        if (state.hasWater) score += 10;
        if (state.health > 15) score += 15;
        return Math.min(score, 100);
    }

    static calculateCombatScore(state, history) {
        let score = 0;
        if (state.hasWeapon) score += 25;
        if (state.hasIronArmor) score += 30;
        if (state.hasDiamondArmor) score += 50;
        if (state.hasShield) score += 15;
        if (history.mobsKilled > 10) score += 20;
        return Math.min(score, 100);
    }

    static calculateExplorationScore(state, history) {
        let score = 0;
        if (history.biomesVisited > 3) score += 30;
        if (history.structuresFound > 0) score += 20;
        if (history.distanceTraveled > 5000) score += 25;
        if (state.hasMaps) score += 15;
        return Math.min(score, 100);
    }

    static calculateCraftingScore(state) {
        let score = 0;
        if (state.hasWoodTools) score += 10;
        if (state.hasStoneTools) score += 20;
        if (state.hasIronTools) score += 35;
        if (state.hasDiamondTools) score += 50;
        if (state.hasEnchantingTable) score += 25;
        return Math.min(score, 100);
    }

    static generateContextualQuests(player, state, history, progress) {
        const quests = [];
        const dimension = player.dimension.id;

        if (state.health < CONFIG.CRITICAL_HEALTH_THRESHOLD) {
            quests.push({
                type: "critical",
                text: "§4[CRITICAL] IMMEDIATE DANGER - Heal or retreat NOW!",
                priority: 100,
                category: "survival"
            });
        }

        if (dimension === "minecraft:the_nether" && !state.hasFireResistance) {
            quests.push({
                type: "dimension",
                text: "§c[NETHER] Brew fire resistance potions for safety",
                priority: 85,
                category: "survival"
            });
        }

        if (dimension === "minecraft:the_end" && !state.hasEnderPearls) {
            quests.push({
                type: "dimension",
                text: "§d[END] Collect ender pearls to navigate islands",
                priority: 80,
                category: "exploration"
            });
        }

        if (!state.hasFood && state.hunger < 10) {
            quests.push({
                type: "survival",
                text: "§e[HUNGER] Critical food shortage - Hunt or harvest immediately",
                priority: 90,
                category: "survival"
            });
        }

        if (state.isNight && !state.hasShelter && progress.survival < 50) {
            quests.push({
                type: "safety",
                text: "§c[NIGHT CYCLE] Build shelter - Hostile spawns active",
                priority: 75,
                category: "survival"
            });
        }

        if (state.inventoryFull && !state.hasEnderChest) {
            quests.push({
                type: "inventory",
                text: "§6[STORAGE] Inventory full - Craft ender chest for portable storage",
                priority: 60,
                category: "crafting"
            });
        }

        if (progress.crafting < 30 && state.hasWood && !state.hasWoodTools) {
            quests.push({
                type: "progression",
                text: "§a[START] Craft wooden tools to begin your journey",
                priority: 70,
                category: "crafting"
            });
        }

        if (progress.crafting >= 30 && state.hasStone && !state.hasStoneTools) {
            quests.push({
                type: "progression",
                text: "§a[UPGRADE] Stone tools available - 2x durability improvement",
                priority: 65,
                category: "crafting"
            });
        }

        if (progress.crafting >= 50 && state.hasIron && !state.hasIronTools) {
            quests.push({
                type: "progression",
                text: "§b[UPGRADE] Smelt iron - Unlock superior tool tier",
                priority: 68,
                category: "crafting"
            });
        }

        if (state.hasIron && !state.hasIronArmor && progress.combat < 40) {
            quests.push({
                type: "combat",
                text: "§b[DEFENSE] Craft iron armor - Reduce damage by 60%",
                priority: 72,
                category: "combat"
            });
        }

        if (state.hasDiamonds && !state.hasDiamondTools) {
            quests.push({
                type: "progression",
                text: "§3[ELITE] Diamond tools available - Maximum efficiency",
                priority: 80,
                category: "crafting"
            });
        }

        if (state.hasDiamonds && !state.hasEnchantingTable) {
            quests.push({
                type: "progression",
                text: "§5[ENCHANT] Build enchanting table - Unlock powerful upgrades",
                priority: 78,
                category: "crafting"
            });
        }

        if (history.stayedInArea > CONFIG.STAGNANT_TIME) {
            quests.push({
                type: "exploration",
                text: "§d[EXPLORE] Stagnant location - New biomes offer unique resources",
                priority: 50,
                category: "exploration"
            });
        }

        if (state.biome === "desert" && !state.hasWater) {
            quests.push({
                type: "biome",
                text: "§6[DESERT] Find oasis or craft water bottles - Dehydration risk",
                priority: 73,
                category: "survival"
            });
        }

        if (state.biome === "ocean" && !state.hasBoat) {
            quests.push({
                type: "biome",
                text: "§9[OCEAN] Craft a boat for efficient water travel",
                priority: 55,
                category: "exploration"
            });
        }

        if (state.nearVillage && !state.hasTradedWithVillager) {
            quests.push({
                type: "trading",
                text: "§2[VILLAGE] Trade with villagers for rare items and discounts",
                priority: 58,
                category: "exploration"
            });
        }

        if (!state.hasShield && progress.combat > 30) {
            quests.push({
                type: "combat",
                text: "§7[DEFENSE] Craft a shield to block attacks and explosions",
                priority: 62,
                category: "combat"
            });
        }

        if (state.lowDurability) {
            quests.push({
                type: "maintenance",
                text: "§e[REPAIR] Tool durability critical - Use anvil or craft replacement",
                priority: 65,
                category: "crafting"
            });
        }

        return quests.sort((a, b) => b.priority - a.priority).slice(0, 4);
    }
}

class IntelligentThreatSystem {
    static analyzeDangerLevel(player, entity, distance) {
        let dangerScore = 0;
        const entityType = entity.typeId;

        if (CONFIG.BOSS_MOBS.includes(entityType)) dangerScore = 100;
        else if (CONFIG.HOSTILE_MOBS.includes(entityType)) dangerScore = 60;
        else if (CONFIG.PASSIVE_DANGER.includes(entityType)) dangerScore = 70;

        if (distance < CONFIG.CRITICAL_THREAT_DISTANCE) dangerScore += 40;
        else if (distance < 8) dangerScore += 20;

        const health = player.getComponent("minecraft:health");
        if (health && health.currentValue < 10) dangerScore += 30;

        if (entityType === "minecraft:creeper") dangerScore += 25;
        if (entityType === "minecraft:warden") dangerScore += 50;

        return Math.min(dangerScore, 100);
    }

    static detectEnvironmentalThreats(player, dimension, location) {
        const threats = [];
        const checkPositions = this.generateCheckPattern(location, 2);

        for (const pos of checkPositions) {
            const cacheKey = `${pos.x}_${pos.y}_${pos.z}`;
            let block = blockCache.get(cacheKey);

            if (!block) {
                block = dimension.getBlock(pos);
                if (block) blockCache.set(cacheKey, block);
            }

            if (block && CONFIG.DANGEROUS_BLOCKS[block.typeId]) {
                const danger = CONFIG.DANGEROUS_BLOCKS[block.typeId];
                threats.push({
                    type: "environmental",
                    message: danger.message,
                    priority: danger.priority,
                    blockType: block.typeId
                });
            }
        }

        return threats;
    }

    static generateCheckPattern(center, radius) {
        const positions = [];
        for (let x = -radius; x <= radius; x++) {
            for (let y = -1; y <= 1; y++) {
                for (let z = -radius; z <= radius; z++) {
                    positions.push({
                        x: Math.floor(center.x + x),
                        y: Math.floor(center.y + y),
                        z: Math.floor(center.z + z)
                    });
                }
            }
        }
        return positions;
    }

    static scanForThreats(player) {
        const threats = [];
        const location = player.location;
        const dimension = player.dimension;

        try {
            const nearbyEntities = dimension.getEntities({
                location: location,
                maxDistance: CONFIG.MAX_THREAT_DISTANCE,
                excludeTypes: ["minecraft:player", "minecraft:item"]
            });

            for (const entity of nearbyEntities) {
                const distance = Math.hypot(
                    entity.location.x - location.x,
                    entity.location.y - location.y,
                    entity.location.z - location.z
                );

                const dangerLevel = this.analyzeDangerLevel(player, entity, distance);

                if (dangerLevel > 50) {
                    const entityName = entity.typeId.replace("minecraft:", "").toUpperCase();
                    let message = "";
                    let priority = Math.floor(dangerLevel / 10);

                    if (dangerLevel >= 90) {
                        message = `§4[EXTREME DANGER] ${entityName} - ${Math.floor(distance)}m - EVADE!`;
                    } else if (dangerLevel >= 70) {
                        message = `§c[HIGH THREAT] ${entityName} - ${Math.floor(distance)}m - Prepare to fight or flee`;
                    } else if (dangerLevel >= 50) {
                        message = `§e[THREAT] ${entityName} detected - ${Math.floor(distance)}m away`;
                    }

                    threats.push({ type: "mob", message, priority, dangerLevel, distance });
                }
            }

            const health = player.getComponent("minecraft:health");
            if (health) {
                if (health.currentValue <= CONFIG.CRITICAL_HEALTH_THRESHOLD) {
                    threats.push({
                        type: "health_critical",
                        message: `§4[CRITICAL] Health: ${Math.floor(health.currentValue)}/20 - HEAL IMMEDIATELY!`,
                        priority: 10
                    });
                } else if (health.currentValue <= CONFIG.LOW_HEALTH_THRESHOLD) {
                    threats.push({
                        type: "health_low",
                        message: `§c[WARNING] Health: ${Math.floor(health.currentValue)}/20 - Find safety and heal`,
                        priority: 7
                    });
                }
            }

            if (player.isInWater) {
                const breath = player.getComponent("minecraft:breathable");
                if (breath && breath.airSupply <= CONFIG.LOW_AIR_THRESHOLD) {
                    threats.push({
                        type: "drowning",
                        message: `§b[DROWNING] Air: ${breath.airSupply}/${breath.totalSupply} - SURFACE NOW!`,
                        priority: 9
                    });
                }
            }

            const envThreats = this.detectEnvironmentalThreats(player, dimension, location);
            threats.push(...envThreats);

        } catch (error) {
            performanceMetrics.errors++;
        }

        return threats.sort((a, b) => b.priority - a.priority);
    }
}

class OreDetectionSystem {
    static scanForValuableOres(player, dimension, location) {
        const oreFinds = [];
        const scanRadius = 5;

        for (let x = -scanRadius; x <= scanRadius; x++) {
            for (let y = -scanRadius; y <= scanRadius; y++) {
                for (let z = -scanRadius; z <= scanRadius; z++) {
                    const pos = {
                        x: Math.floor(location.x + x),
                        y: Math.floor(location.y + y),
                        z: Math.floor(location.z + z)
                    };

                    const block = dimension.getBlock(pos);
                    if (block && CONFIG.VALUABLE_ORES[block.typeId]) {
                        const ore = CONFIG.VALUABLE_ORES[block.typeId];
                        oreFinds.push({
                            type: block.typeId,
                            message: ore.message,
                            rarity: ore.rarity,
                            distance: Math.hypot(x, y, z)
                        });
                    }
                }
            }
        }

        return oreFinds.sort((a, b) => b.rarity - a.rarity);
    }
}

class EnhancedStateAnalyzer {
    static analyzeComprehensiveState(player) {
        const inventory = player.getComponent("minecraft:inventory");
        const health = player.getComponent("minecraft:health");
        const location = player.location;
        const dimension = player.dimension;
        const data = playerData.get(player.id) || {};

        const state = {
            health: 20,
            hunger: 20,
            lowHealth: false,
            hasFood: false,
            hasBed: false,
            hasWater: false,
            hasShelter: false,
            hasWood: false,
            hasWoodTools: false,
            hasStone: false,
            hasStoneTools: false,
            hasIron: false,
            hasIronTools: false,
            hasIronArmor: false,
            hasDiamonds: false,
            hasDiamondTools: false,
            hasDiamondArmor: false,
            hasEnchantingTable: false,
            hasEnderChest: false,
            hasShield: false,
            hasWeapon: false,
            hasBoat: false,
            hasMaps: false,
            hasFireResistance: false,
            hasEnderPearls: false,
            inventoryFull: false,
            lowDurability: false,
            nearVillage: false,
            hasTradedWithVillager: data.hasTradedWithVillager || false,
            biome: "unknown",
            isNight: false,
            dimension: dimension.id
        };

        try {
            if (health) {
                state.health = health.currentValue;
                state.lowHealth = health.currentValue <= CONFIG.LOW_HEALTH_THRESHOLD;
            }

            const cacheKey = `${Math.floor(location.x)}_${Math.floor(location.z)}`;
            let biome = biomeCache.get(cacheKey);

            if (!biome && typeof dimension.getBiome === "function") {
                biome = dimension.getBiome(location)?.id.replace("minecraft:", "") || "unknown";
                biomeCache.set(cacheKey, biome);
            }
            state.biome = biome || "unknown";

            const timeOfDay = world.getTimeOfDay();
            state.isNight = timeOfDay >= 13000 && timeOfDay <= 23000;

            const aboveBlock = dimension.getBlock({
                x: Math.floor(location.x),
                y: Math.floor(location.y + 2),
                z: Math.floor(location.z)
            });
            state.hasShelter = aboveBlock && !aboveBlock.isAir;

            if (inventory && inventory.container) {
                const container = inventory.container;
                state.inventoryFull = container.emptySlotsCount === 0;

                for (let i = 0; i < container.size; i++) {
                    const item = container.getItem(i);
                    if (!item) continue;

                    const itemId = item.typeId;
                    const durability = item.getComponent("minecraft:durability");

                    if (durability && durability.damage / durability.maxDurability > 0.8) {
                        state.lowDurability = true;
                    }

                    if (item.getComponent("minecraft:food")) state.hasFood = true;
                    if (itemId.includes("bed")) state.hasBed = true;
                    if (itemId === "minecraft:water_bucket") state.hasWater = true;
                    if (itemId.includes("log") || itemId.includes("planks")) state.hasWood = true;
                    if (itemId.startsWith("minecraft:wooden_")) state.hasWoodTools = true;
                    if (itemId.startsWith("minecraft:stone_")) state.hasStoneTools = true;
                    if (itemId.startsWith("minecraft:iron_") &&
                        (itemId.includes("_pickaxe") || itemId.includes("_axe") || itemId.includes("_shovel"))) {
                        state.hasIronTools = true;
                    }
                    if (itemId.startsWith("minecraft:iron_") &&
                        (itemId.includes("_helmet") || itemId.includes("_chestplate") ||
                            itemId.includes("_leggings") || itemId.includes("_boots"))) {
                        state.hasIronArmor = true;
                    }
                    if (itemId === "minecraft:diamond") state.hasDiamonds = true;
                    if (itemId.startsWith("minecraft:diamond_") &&
                        (itemId.includes("_pickaxe") || itemId.includes("_axe") || itemId.includes("_shovel"))) {
                        state.hasDiamondTools = true;
                    }
                    if (itemId.startsWith("minecraft:diamond_") &&
                        (itemId.includes("_helmet") || itemId.includes("_chestplate") ||
                            itemId.includes("_leggings") || itemId.includes("_boots"))) {
                        state.hasDiamondArmor = true;
                    }
                    if (itemId === "minecraft:enchanting_table") state.hasEnchantingTable = true;
                    if (itemId === "minecraft:ender_chest") state.hasEnderChest = true;
                    if (itemId === "minecraft:shield") state.hasShield = true;
                    if (itemId.includes("_sword") || itemId.includes("_axe")) state.hasWeapon = true;
                    if (itemId === "minecraft:boat" || itemId.includes("_boat")) state.hasBoat = true;
                    if (itemId.includes("_map") || itemId === "minecraft:filled_map") state.hasMaps = true;
                    if (itemId === "minecraft:fire_resistance") state.hasFireResistance = true;
                    if (itemId === "minecraft:ender_pearl") state.hasEnderPearls = true;
                    if (itemId === "minecraft:cobblestone" || itemId === "minecraft:stone") state.hasStone = true;
                    if (itemId === "minecraft:iron_ingot") state.hasIron = true;
                }
            }

            const nearbyVillagers = dimension.getEntities({
                location: location,
                maxDistance: 50,
                type: "minecraft:villager"
            });
            state.nearVillage = nearbyVillagers.length > 3;

        } catch (error) {
            performanceMetrics.errors++;
        }

        return state;
    }
}

class ADSGPTPremiumSystem {
    static initialize() {
        world.sendMessage("§6═══════════════════════════════════════════════════");
        world.sendMessage("§b         ADS GPT §3PREMIUM");
        world.sendMessage("§7    Advanced Data-driven Smart Game Player Tracker");
        world.sendMessage("§6═══════════════════════════════════════════════════");
        world.sendMessage("§a✓ §7Intelligent threat detection");
        world.sendMessage("§a✓ §7Contextual quest generation");
        world.sendMessage("§a✓ §7Ore discovery system");
        world.sendMessage("§a✓ §7Performance optimization");
        world.sendMessage("§6═══════════════════════════════════════════════════");

        system.runInterval(() => {
            const startTime = Date.now();
            for (const player of world.getAllPlayers()) {
                this.trackPlayerAdvanced(player);
            }
            performanceMetrics.avgProcessTime = Date.now() - startTime;
            performanceMetrics.updates++;
        }, CONFIG.SCAN_INTERVAL);

        system.runInterval(() => {
            for (const player of world.getAllPlayers()) {
                this.processThreats(player);
            }
        }, CONFIG.THREAT_CHECK_INTERVAL);

        system.runInterval(() => {
            for (const player of world.getAllPlayers()) {
                this.updateQuestSystem(player);
            }
        }, CONFIG.QUEST_UPDATE_INTERVAL);

        system.runInterval(() => {
            this.performanceReport();
        }, CONFIG.PERFORMANCE_CHECK_INTERVAL);
    }

    static trackPlayerAdvanced(player) {
        const playerId = player.id;

        if (!playerData.has(playerId)) {
            playerData.set(playerId, {
                lastLocation: player.location,
                joinTime: Date.now(),
                stayedInArea: 0,
                lastThreatMessage: "",
                lastQuests: "",
                mobsKilled: 0,
                biomesVisited: new Set(),
                structuresFound: 0,
                distanceTraveled: 0,
                hasTradedWithVillager: false
            });

            player.sendMessage("§a[ADS GPT PREMIUM] §7Elite tracking initialized");
            player.sendMessage("§7Advanced AI companion online - All systems operational");
        }

        const data = playerData.get(playerId);
        const currentLoc = player.location;
        const dist = Math.hypot(
            currentLoc.x - data.lastLocation.x,
            currentLoc.z - data.lastLocation.z
        );

        if (dist < CONFIG.MOVEMENT_THRESHOLD) {
            data.stayedInArea += CONFIG.SCAN_INTERVAL;
        } else {
            data.stayedInArea = 0;
            data.distanceTraveled += dist;
            data.lastLocation = currentLoc;
        }

        const state = EnhancedStateAnalyzer.analyzeComprehensiveState(player);
        if (state.biome !== "unknown") {
            data.biomesVisited.add(state.biome);
        }

        const ores = OreDetectionSystem.scanForValuableOres(player, player.dimension, currentLoc);
        if (ores.length > 0) {
            const cooldownKey = `ore_${playerId}`;
            if (!this.isOnCooldown(cooldownKey, 300)) {
                player.sendMessage(ores[0].message);
                this.setCooldown(cooldownKey, 300);
            }
        }
    }

    static processThreats(player) {
        const threats = IntelligentThreatSystem.scanForThreats(player);
        const data = playerData.get(player.id);

        if (threats.length > 0) {
            const topThreat = threats[0];
            const cooldownKey = `threat_${player.id}_${topThreat.type}`;

            if (topThreat.message !== data.lastThreatMessage && !this.isOnCooldown(cooldownKey, 100)) {
                player.sendMessage(topThreat.message);
                data.lastThreatMessage = topThreat.message;
                this.setCooldown(cooldownKey, 100);
            }
        }
    }

    static updateQuestSystem(player) {
        const state = EnhancedStateAnalyzer.analyzeComprehensiveState(player);
        const data = playerData.get(player.id);
        const history = {
            stayedInArea: data.stayedInArea,
            mobsKilled: data.mobsKilled,
            biomesVisited: data.biomesVisited.size,
            structuresFound: data.structuresFound,
            distanceTraveled: data.distanceTraveled
        };

        const progress = AdvancedQuestEngine.evaluatePlayerProgress(state, history);
        const quests = AdvancedQuestEngine.generateContextualQuests(player, state, history, progress);
        const questsString = JSON.stringify(quests);

        if (quests.length > 0 && questsString !== data.lastQuests) {
            const cooldownKey = `quest_${player.id}`;
            if (!this.isOnCooldown(cooldownKey, 180)) {
                player.sendMessage("§6━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                player.sendMessage("§b[QUEST INTELLIGENCE SYSTEM]");
                player.sendMessage("§6━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                for (const quest of quests) {
                    player.sendMessage(quest.text);
                }
                player.sendMessage("§6━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                data.lastQuests = questsString;
                this.setCooldown(cooldownKey, 180);
            }
        }
    }

    static isOnCooldown(key, ticks) {
        const cooldown = threatCooldowns.get(key);
        if (!cooldown) return false;
        return (Date.now() - cooldown) < (ticks * 50);
    }

    static setCooldown(key, ticks) {
        threatCooldowns.set(key, Date.now());
    }

    static performanceReport() {
        const players = world.getAllPlayers();
        if (players.length === 0) return;

        const report = [
            `§7[PERFORMANCE] Updates: ${performanceMetrics.updates} | Errors: ${performanceMetrics.errors} | Avg Time: ${performanceMetrics.avgProcessTime}ms`,
            `§7[TRACKING] Active Players: ${players.length} | Cache Size: ${biomeCache.cache.size + blockCache.cache.size}`
        ];

        console.warn(report.join("\n"));

        if (biomeCache.cache.size > 1000) biomeCache.clear();
        if (blockCache.cache.size > 500) blockCache.clear();
    }
}

class StructureIntelligence {
    static scanAdvanced(player) {
        const location = player.location;
        const dimension = player.dimension;
        const playerId = player.id;

        if (!structuresNotified.has(playerId)) {
            structuresNotified.set(playerId, new Set());
        }

        const notified = structuresNotified.get(playerId);

        try {
            if (typeof dimension.getEntities === "function") {
                const nearbyVillagers = dimension.getEntities({
                    location: location,
                    maxDistance: 100,
                    type: "minecraft:villager"
                });

                if (nearbyVillagers.length >= 3 && !notified.has("village")) {
                    player.sendMessage("§2[STRUCTURE] §aVillage detected nearby - Trading opportunities available!");
                    notified.add("village");
                }

                const pillagers = dimension.getEntities({
                    location: location,
                    maxDistance: 150,
                    type: "minecraft:pillager"
                });

                if (pillagers.length >= 2 && !notified.has("outpost")) {
                    player.sendMessage("§c[STRUCTURE] §6Pillager Outpost detected - High danger zone!");
                    notified.add("outpost");
                }
            }

            if (typeof dimension.getGeneratedStructures === "function") {
                const structures = dimension.getGeneratedStructures(location) || [];

                for (const structure of structures) {
                    const structName = typeof structure === 'string' ? structure : structure.toString().replace("minecraft:", "");
                    if (!notified.has(structName)) {
                        const messages = {
                            "village": "§2[DISCOVERY] §aVillage - Trade, rest, and resupply",
                            "desert_pyramid": "§6[DISCOVERY] §eDesert Temple - Treasure and traps await",
                            "jungle_pyramid": "§a[DISCOVERY] §2Jungle Temple - Ancient mechanisms inside",
                            "pillager_outpost": "§c[DISCOVERY] §4Pillager Outpost - Extreme danger!",
                            "mansion": "§5[DISCOVERY] §dWoodland Mansion - Rare loot and totems",
                            "stronghold": "§3[DISCOVERY] §bStronghold - Portal to The End",
                            "fortress": "§4[DISCOVERY] §cNether Fortress - Blaze rods and wither skeletons",
                            "bastion": "§6[DISCOVERY] §eBastion Remnant - Netherite and piglin gold",
                            "end_city": "§d[DISCOVERY] §5End City - Elytra and shulker boxes",
                            "monument": "§b[DISCOVERY] §3Ocean Monument - Sponges and prismarine"
                        };

                        player.sendMessage(messages[structName] || `§7[DISCOVERY] ${structName} structure found`);
                        notified.add(structName);

                        const data = playerData.get(playerId);
                        if (data) data.structuresFound++;
                    }
                }
            }

        }
        catch (error) {
            performanceMetrics.errors++;
        }
    }
}

let systemInitialized = false;

system.run(() => {
    if (!systemInitialized) {
        ADSGPTPremiumSystem.initialize();
        systemInitialized = true;
    }
});

world.afterEvents.playerSpawn.subscribe((event) => {
    const player = event.player;
    if (event.initialSpawn) {
        system.runTimeout(() => {
            player.sendMessage("§6━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            player.sendMessage("§b           ADS GPT §3PREMIUM");
            player.sendMessage("§7    Your Elite Survival Companion");
            player.sendMessage("§6━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            player.sendMessage("§a✓ §7Real-time threat intelligence");
            player.sendMessage("§a✓ §7Dynamic contextual quests");
            player.sendMessage("§a✓ §7Valuable ore detection");
            player.sendMessage("§a✓ §7Structure discovery alerts");
            player.sendMessage("§a✓ §7Performance optimized");
            player.sendMessage("§6━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            player.sendMessage("§7Stay alert. Stay alive. Dominate the world.");
        }, 40);
    }
});

world.afterEvents.entityDie.subscribe((event) => {
    if (event.damageSource.damagingEntity?.typeId === "minecraft:player") {
        const player = event.damageSource.damagingEntity;
        const data = playerData.get(player.id);
        if (data && CONFIG.HOSTILE_MOBS.includes(event.deadEntity.typeId)) {
            data.mobsKilled++;

            if (data.mobsKilled % 10 === 0) {
                player.sendMessage(`§e[COMBAT] §6Total kills: ${data.mobsKilled} - Combat mastery increasing!`);
            }
        }
    }
});

world.afterEvents.entityHurt.subscribe((event) => {
    if (event.hurtEntity.typeId === "minecraft:player" && event.damageSource.cause === "fall") {
        const player = event.hurtEntity;
        if (event.damage > 5) {
            player.sendMessage("§e[CAUTION] §6Severe fall damage - Watch your step!");
        }
    }
});

system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
        StructureIntelligence.scanAdvanced(player);
    }
}, 2000);
