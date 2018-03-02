import UndoManager from 'undo-manager';
import Unit from './Unit';
import Tower from './Tower';
import HexUtils from './HexUtils';
import TreeUtils from './TreeUtils';
import Died from './Died';
import KingdomBalance from './KingdomBalance';
import IllegalMoveError from './IllegalMoveError';

export default class Arbiter {
    static UNIT_PRICE = 10;
    static TOWER_PRICE = 15;
    static UNIT_MAX_LEVEL = 4;

    constructor(world) {
        this.world = world;

        this.selection = null;
        this.currentPlayer = null;
        this.currentKingdom = null;
        this.undoManager = new UndoManager();
    }

    setCurrentPlayer(player) {
        this.currentPlayer = player;
        this.currentKingdom = null;

        this.undoManager.clear();

        player.notifyTurn(this);
    }

    setCurrentKingdom(kingdom) {
        this._checkPlayerSelected();

        if (kingdom && kingdom.player !== this.currentPlayer) {
            throw new Error('Cannot select opponent kingdom');
        }

        const lastKingdom = this.currentKingdom;

        this.currentKingdom = kingdom;

        this.undoManager.add({
            undo: () => {
                this.setCurrentKingdom(lastKingdom);
            },
            redo: () => {
                this.setCurrentKingdom(kingdom);
            },
        });
    }

    takeUnitAt(hexCoords) {
        this._checkKingdomSelected();

        const hex = this.world.getHexAt(hexCoords);

        if (hex.kingdom !== this.currentKingdom) {
            throw new Error('Cannot take unit from another kingdom');
        }

        if (!hex.hasUnit()) {
            throw new Error('There is no unit at theses coords');
        }

        if (hex.getUnit().played) {
            throw new Error('This unit can no longer move this turn');
        }

        if (null !== this.selection) {
            throw new Error('There is already something selected');
        }

        this.selection = this.world.removeUnitAt(hexCoords);

        this.undoManager.add({
            undo: () => {
                this.placeAt(hexCoords);
            },
            redo: () => {
                this.takeUnitAt(hexCoords);
            },
        });
    }

    placeAt(hexCoords) {
        const hex = this.world.getHexAt(hexCoords);

        if (this.selection instanceof Unit) {
            this._placeUnitAt(hex);
        }

        if (this.selection instanceof Tower) {
            this._placeTowerAt(hex);
        }
    }

    buyUnit() {
        if (this.currentKingdom.money < Arbiter.UNIT_PRICE) {
            throw new IllegalMoveError('Not enough money');
        }

        if (this.selection instanceof Unit && this.selection.level >= Arbiter.UNIT_MAX_LEVEL) {
            throw new Error('Cannot upgrade selectionned unit, already max level');
        }

        if (this.selection instanceof Unit) {
            this.selection.level++;
        } else {
            this.selection = new Unit();
        }

        this.currentKingdom.money -= Arbiter.UNIT_PRICE;

        this.undoManager.add({
            undo: () => {
                this.selection.level--;

                if (0 === this.selection.level) {
                    this.selection = null;
                }

                this.currentKingdom.money += Arbiter.UNIT_PRICE;
            },
            redo: () => {
                this.buyUnit();
            },
        });
    }

    buyTower() {
        if (this.currentKingdom.money < Arbiter.TOWER_PRICE) {
            throw new Error('Not enough money');
        }

        if (null !== this.selection) {
            throw new Error('Cannot buy tower, place selected entity first');
        }

        this.currentKingdom.money -= Arbiter.TOWER_PRICE;
        this.selection = new Tower();

        this.undoManager.add({
            undo: () => {
                this.currentKingdom.money += Arbiter.TOWER_PRICE;
                this.selection = null;
            },
            redo: () => {
                this.buyTower();
            },
        });
    }

    /**
     * Guess which action to do by giving a hex coords
     *
     * @param {Hex} coords
     *
     * @throws {Error}
     */
    smartAction(coords) {
        const hex = this.world.getHexAt(coords);

        if (null === this.selection) {
            if (hex.kingdom) {
                if (hex.kingdom === this.currentKingdom) {
                    if (hex.hasUnit()) {
                        this.takeUnitAt(hex);
                    }
                } else {
                    if (hex.kingdom.player === this.currentPlayer) {
                        this.setCurrentKingdom(hex.kingdom);

                        if (hex.hasUnit()) {
                            this.takeUnitAt(hex);
                        }
                    }
                }
            }
        } else {
            if (hex.kingdom) {
                if (hex.kingdom === this.currentKingdom) {
                    this.placeAt(hex);
                } else {
                    if (hex.kingdom.player === this.currentPlayer) {
                        throw new Error('Cannot change kingdom while having a selected entity');
                    } else {
                        this.placeAt(hex);
                    }
                }
            } else {
                this.placeAt(hex);
            }
        }
    }

    endTurn() {
        if (this.selection) {
            throw new Error('Cannot end turn while having selected an entity');
        }

        this._resetUnitsMove(this.currentPlayer);

        let nextIndex = this.world.config.players.indexOf(this.currentPlayer) + 1;

        if (nextIndex > this.world.config.players.length - 1) {
            nextIndex = 0;
            this.world.turn++;
        }

        const nextPlayer = this.world.config.players[nextIndex];

        if (this.world.turn > 0) {
            this._payKingdomsIncome(nextPlayer);
        }

        TreeUtils.spawnTrees(this.world);

        this.setCurrentPlayer(nextPlayer);
    }

    undo() {
        this.undoManager.undo();
    }

    hasUndo() {
        return this.undoManager.hasUndo();
    }

    redo() {
        this.undoManager.redo();
    }

    hasRedo() {
        return this.undoManager.hasRedo();
    }

    undoAll() {
        while (this.hasUndo()) {
            this.undoManager.undo();
        }
    }

    _resetUnitsMove(player) {
        this.world.kingdoms
            .filter(kingdom => kingdom.player === player)
            .forEach(kingdom => {
                kingdom.hexs.forEach(hex => {
                    if (hex.entity instanceof Unit) {
                        hex.entity.played = false;
                    }
                });
            })
        ;
    }

    _payKingdomsIncome(player) {
        this.world.kingdoms
            .filter(kingdom => kingdom.player === player)
            .forEach(kingdom => {
                kingdom.balance = new KingdomBalance();

                kingdom.balance.lastCapital = kingdom.money;
                kingdom.balance.income = HexUtils.getKingdomIncome(kingdom);
                kingdom.balance.maintenance = HexUtils.getKingdomMaintenanceCost(kingdom);

                // Get income and pay units maintenance
                kingdom.money += kingdom.balance.income;
                kingdom.money -= kingdom.balance.maintenance;

                // Replace dieds with trees
                kingdom.hexs.filter(hex => hex.hasDied()).forEach(hex => {
                    hex.entity = TreeUtils.createTreeForHex(this.world, hex);
                });

                // Kill unpaid units
                if (kingdom.money < 0) {
                    kingdom.hexs.filter(hex => hex.hasUnit()).forEach(hex => {
                        hex.entity = new Died();
                    });

                    kingdom.money = 0;
                }
            })
        ;

        // On single hexs...
        const singleHexs = this.world.hexs
            .filter(hex => hex.player === player)
            .filter(hex => !hex.kingdom)
        ;

        // Replace dieds with trees
        singleHexs
            .filter(hex => hex.hasDied())
            .forEach(hex => hex.entity = TreeUtils.createTreeForHex(this.world, hex))
        ;

        // Kill units on a single hex kingdom
        singleHexs
            .filter(hex => hex.hasUnit())
            .forEach(hex => hex.entity = new Died())
        ;
    }

    _placeUnitAt(hex) {
        if (hex.kingdom !== this.currentKingdom) {
            this._placeUnitCapture(hex);
        } else {
            this._placeUnitInsideKingdom(hex);
        }
    }

    _placeUnitCapture(hex) {
        const undoCallbacks = [];

        if (!HexUtils.isHexAdjacentKingdom(this.world, hex, this.currentKingdom)) {
            throw new Error('Cannot capture this hex, too far of kingdom');
        }

        const protectingUnits = HexUtils
            .getProtectingUnits(this.world, hex, this.selection.level)
        ;

        if (protectingUnits.length > 0) {
            throw new IllegalMoveError('Cannot capture this hex, units protecting it', protectingUnits);
        }

        const lastHexEntity = hex.entity;
        const lastHexKingdom = hex.kingdom;
        const lastHexPlayer = hex.player;

        if (hex.hasCapital()) {
            const lastHexKingdomMoney = hex.kingdom.money;
            hex.kingdom.money = 0;

            undoCallbacks.push(() => {
                hex.kingdom.money = lastHexKingdomMoney;
            });
        }

        // Place unit from selection to hex
        hex.setEntity(this.selection);
        this.selection.played = true;
        this.selection = null;

        undoCallbacks.push(() => {
            this.selection = hex.entity;
            this.selection.played = false;
            hex.setEntity(lastHexEntity);
        });

        // Take hex from opponent kingdom to ours
        if (hex.kingdom) {
            hex.kingdom.removeHex(hex);

            undoCallbacks.push(() => {
                hex.kingdom.hexs.push(hex);
            });

            // Delete kingdom if it remains only one hex
            if (hex.kingdom.hexs.length < 2) {
                const lastKingdom = hex.kingdom;
                const lastKingdomHexs = hex.kingdom.hexs;

                hex.kingdom.hexs[0].kingdom = null;

                undoCallbacks.push(() => {
                    hex.kingdom.hexs[0].kingdom = lastKingdom;
                });

                hex.kingdom.hexs = [];
                this.world.removeKingdom(hex.kingdom);

                undoCallbacks.push(() => {
                    this.world.kingdoms.push(hex.kingdom);
                    hex.kingdom.hexs = lastKingdomHexs;
                    hex.kingdom.hexs.push(hex);
                });
            }
        }

        // Move hex from opponent kingdom to capturing kingdom
        hex.kingdom = this.currentKingdom;
        hex.player = this.currentKingdom.player;
        this.currentKingdom.hexs.push(hex);

        undoCallbacks.push(() => {
            this.currentKingdom.removeHex(hex);
            hex.player = lastHexPlayer;
            hex.kingdom = lastHexKingdom;
        });

        undoCallbacks.push(HexUtils.mergeKingdomsOnCapture(this.world, hex));
        undoCallbacks.push(HexUtils.splitKingdomsOnCapture(this.world, hex));

        undoCallbacks.push(HexUtils.rebuildKingdomsCapitals(this.world));
        undoCallbacks.push(HexUtils.transformCapitalsOnSingleHexsToTrees(this.world));

        this.undoManager.add({
            undo: () => {
                undoCallbacks
                    .reverse()
                    .forEach(undoCallback => undoCallback())
                ;
            },
            redo: () => {
                this._placeUnitAt(hex);
            },
        });
    }

    _placeUnitInsideKingdom(hex) {
        if (hex.hasTower()) {
            throw new Error('Cannot place unit, there is a tower here');
        }

        if (hex.hasCapital()) {
            throw new Error('Cannot place unit, there is the kingdom capital here');
        }

        if (hex.hasUnit()) {
            if ((hex.entity.level + this.selection.level) > Arbiter.UNIT_MAX_LEVEL) {
                throw new Error('Cannot merge units as the sum of levels is too high');
            }

            const lastSelection = this.selection;

            hex.entity.level += this.selection.level;
            this.selection = null;

            this.undoManager.add({
                undo: () => {
                    this.selection = lastSelection;
                    hex.entity.level -= this.selection.level;
                },
                redo: () => {
                    this._placeUnitAt(hex);
                },
            });
        } else {
            if (hex.hasDied() || hex.hasTree()) {
                this.selection.played = true;
            }

            this.world.setEntityAt(hex, this.selection);
            this.selection = null;

            this.undoManager.add({
                undo: () => {
                    this.selection = this.world.getEntityAt(hex);
                    this.world.setEntityAt(hex, null);
                },
                redo: () => {
                    this._placeUnitAt(hex);
                },
            });
        }
    }

    _placeTowerAt(hex) {
        if (hex.kingdom !== this.currentKingdom) {
            throw new Error('Must place tower inside current kingdom');
        }

        if (hex.entity !== null) {
            throw new Error('Must place tower on empty hex');
        }

        hex.entity = this.selection;
        this.selection = null;

        this.undoManager.add({
            undo: () => {
                this.selection = hex.entity;
                hex.entity = null;
            },
            redo: () => {
                this._placeTowerAt(hex);
            },
        });
    }

    _checkPlayerSelected() {
        if (null === this.currentPlayer) {
            throw new Error('A player must be selected');
        }
    }

    _checkKingdomSelected() {
        this._checkPlayerSelected();

        if (null === this.currentKingdom) {
            throw new Error('A kingdom must be selected');
        }
    }
}