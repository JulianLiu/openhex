import React, { Component } from 'react';
import { Translation } from 'react-i18next';
import i18n from '../../i18n';

export default class GameMenu extends Component {
    endTurn() {
        try {
            this.props.arbiter.endTurn();
        } catch (e) {
            this.props.handleArbiterError(e);
        }

        this.props.updateCallback();
    }

    undo() {
        this.props.arbiter.undo();
        this.props.updateCallback();
    }

    enabledIf(bool) {
        return !bool ? ' disabled' : '';
    }

    render() {
        const arbiter = this.props.arbiter;

        return (
            <Translation i18n={ i18n }>
                {t => (
                    <div className="game-menu">
                        <h3 className="card-header d-none d-md-block">{ t('game_menu.turn_number', { turn: arbiter.world.turn + 1 }) }</h3>
                        <div className="card-body">
                            <div className="inline-buttons">
                                <button
                                    className={ "btn btn-outline-primary" + this.enabledIf(arbiter.hasUndo() && !arbiter.winner) }
                                    onClick={ () => { this.undo(); } }
                                >{ t('game_menu.undo') }</button>
                                <button
                                    className={ "btn btn-success" + this.enabledIf(!arbiter.winner) }
                                    onClick={ () => { this.endTurn(); } }
                                >{ t('game_menu.end_turn') }</button>
                            </div>
                        </div>
                    </div>
                )}
            </Translation>
        );
    }
}
