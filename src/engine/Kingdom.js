export default class Kingdom {
    constructor(hexs) {
        this.hexs = hexs;
        this.money = 0;
        this.player = hexs[0].player;

        this.hexs.forEach(hex => hex.kingdom = this);

        this._initMoney();
    }

    _initMoney() {
        this.money = this.getSize() * 5;
    }

    getSize() {
        return this.hexs.length;
    }

    getUnits() {
        return this.hexs
            .filter(hex => hex.hasUnit())
            .map(hex => hex.entity)
        ;
    }

    removeHex(hex) {
        this.hexs = this.hexs.filter(h => h !== hex);
    }
}